# Wetsanalyse op OpenShift — installatiehandleiding

Stap-voor-stap uitrol van de wetsanalyse-stack (API · frontend · wettenbank-MCP · PostgreSQL) op een
**namespace** van een gedeelde on-prem OpenShift-cluster. Geen cluster-admin nodig: alle objecten zijn
namespaced en draaien onder de **restricted-v2 SCC** (willekeurige UID + gid 0 — de images zijn daarop
voorbereid). De database draait via de **CloudNativePG-operator** met WAL-archivering + S3-backups.

De manifesten staan in `deploy/openshift/` (Kustomize): `base/` + `overlays/{local,beproeving,managed-prod}`
en de `components/postgres-cnpg`-database. Kies de overlay die bij je doel past.

---

## 1. Voorwaarden

- **`oc`-CLI**, ingelogd en in het juiste project: `oc whoami` en `oc project <namespace>`.
- **CloudNativePG-operator** cluster-wide aanwezig (door het platformteam):
  `oc get crd clusters.postgresql.cnpg.io` moet bestaan. Zo niet → gebruik de `local`-overlay
  (kale Postgres) of vraag het platformteam de operator te installeren.
- **S3-bucket + credentials** voor de WAL/backups (alleen voor beproeving/managed-prod).
- **Images** op GHCR: `ghcr.io/palmw01/{wetsanalyse-api,wetsanalyse-frontend,wettenbank-mcp}`.
  Zijn die privé, maak dan een image-pull-secret en koppel die aan de `default`-serviceaccount:
  `oc create secret docker-registry ghcr --docker-server=ghcr.io --docker-username=<u> --docker-password=<token>`
  en `oc secrets link default ghcr --for=pull`.

---

## 2. Namespace/project

```bash
oc new-project wetsanalyse-beproeving   # of selecteer een bestaande: oc project <naam>
```

De overlay zet zelf de namespace (`wetsanalyse-local|-beproeving|-prod`); laat die overeenkomen met je
project of pas het `namespace:`-veld in de overlay-`kustomization.yaml` aan.

---

## 3. Secrets aanmaken (buiten Kustomize)

De app leest secrets als **bestanden** via het `*_FILE`-patroon; in OpenShift mount je daarvoor één
`Secret` per service op `/run/secrets`. De sleutelnamen worden de bestandsnamen — neem ze exact over.

```bash
# API: client-/admin-tokens, MCP-token, LLM-key en de Fernet-master-key.
oc create secret generic wetsanalyse-api-secrets \
  --from-literal=api_tokens="client1:<token>,client2:<token>" \
  --from-literal=admin_tokens="admin:<admin-token>" \
  --from-literal=wettenbank_token="<mcp-bearer-token>" \
  --from-literal=llm_api_key="<azure-ai-foundry-key>" \
  --from-literal=llm_config_secret="$(python3 -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"

# Frontend (BFF): alleen de tokenwaarden (zonder "id:"-prefix) waarmee de BFF de API aanroept.
oc create secret generic wetsanalyse-frontend-secrets \
  --from-literal=frontend_api_token="<token>" \
  --from-literal=frontend_admin_token="<admin-token>"

# MCP: per-client bearer-tokens.
oc create secret generic wettenbank-mcp-secrets \
  --from-literal=mcp_auth_tokens="client1:<mcp-bearer-token>"

# S3-credentials voor de CNPG-backups (alleen beproeving/managed-prod).
oc create secret generic wetsanalyse-db-backup-s3 \
  --from-literal=ACCESS_KEY_ID="<key>" \
  --from-literal=ACCESS_SECRET_KEY="<secret>"
```

De **database**-connection-secret (`wetsanalyse-db-app`, sleutel `uri`) hoef je niet zelf te maken: de
CloudNativePG-operator genereert die bij het aanmaken van het cluster. De API leest `uri` als
`DATABASE_URL` en `app/db.py` normaliseert `postgresql://` automatisch naar de asyncpg-driver.

> De `local`-overlay genereert al deze secrets zelf met dev-waarden (auth uit) — sla deze stap dan over.

---

## 4. Database (CloudNativePG)

Vul vóór het uitrollen de S3-placeholders in `components/postgres-cnpg/cluster.yaml`
(`destinationPath`, `endpointURL`) in, of patch ze in je overlay. Na `oc apply -k` (stap 5) maakt de
operator het cluster aan:

```bash
oc get cluster wetsanalyse-db            # wacht tot "Cluster in healthy state"
oc get secret wetsanalyse-db-app         # door de operator gegenereerd (bevat `uri`)
oc get backup,scheduledbackup            # WAL-archivering + dagelijkse base-backup
```

Controleer in de pod-logs dat WAL-archivering naar S3 loopt (`oc logs wetsanalyse-db-1 -c postgres`).

---

## 5. Uitrollen

```bash
# Learn/CRC (kale Postgres + dev-secrets, auth uit):
oc apply -k deploy/openshift/overlays/local

# Beproevings-cluster (CNPG, secrets uit stap 3):
oc apply -k deploy/openshift/overlays/beproeving

# Gedeelde productie-namespace (HA + HPA + PDB + NetworkPolicy + CNPG):
oc apply -k deploy/openshift/overlays/managed-prod
```

Vul vóór beproeving/managed-prod `LLM_MODEL`/`LLM_API_BASE` in de overlay-`kustomization.yaml` in.
Controleer:

```bash
oc get pods                      # alle pods Running/Ready, geen CreateContainerConfigError (secret mist?)
oc get route wetsanalyse-frontend -o jsonpath='{.spec.host}{"\n"}'
```

Geen pods in `CrashLoopBackOff` met SCC-/permissiefouten = de arbitrary-UID-images werken.

---

## 6. Verifiëren (end-to-end)

```bash
HOST=$(oc get route wetsanalyse-frontend -o jsonpath='{.spec.host}')
curl -sf "https://$HOST/api/health"      # {"status":"ok",...}
oc exec deploy/wetsanalyse-api -- python -c "import urllib.request,json; \
  print(urllib.request.urlopen('http://127.0.0.1:3000/ready').read().decode())"
```

`/ready` moet `database_geconfigureerd: true` en `llm_model_gezet: true` tonen. Open daarna
`https://$HOST` in de browser, maak een analyse aan en controleer dat:
- de **SSE-voortgangsstream** open blijft (>60s — bewijst de `haproxy.router.openshift.io/timeout`-Route-annotatie);
- `oc delete pod -l app.kubernetes.io/name=wetsanalyse-api` een lopende analyse niet verliest
  (de reaper herstelt de job → `retry`).

---

## 7. Beheer & onderhoud

- **Image-update**: CI pusht een nieuwe digest naar GHCR; rol uit met een nieuwe Kustomize-bundel
  (`oc apply -k …`) of via OpenShift GitOps/ArgoCD dat de repo synct. Forceer desnoods
  `oc rollout restart deploy/wetsanalyse-api`.
- **Secret-rotatie**: werk de `Secret` bij en `oc rollout restart` de betreffende Deployment
  (de app leest de `*_FILE`-bestanden opnieuw bij herstart). Voor het DB-wachtwoord: CNPG beheert
  dat zelf; gebruik de operator-procedure i.p.v. handmatig.
- **Backup-restore-test**: maak periodiek een nieuw cluster `bootstrap.recovery` vanuit de
  S3-backup en controleer de data — een backup die je nooit terugzet, is geen backup.
- **Schalen**: HPA (managed-prod) schaalt de API/frontend op CPU. Let op de **per-replica**
  LLM-concurrency-rem en rate-limit (in-process; schaalt lineair mee — zie `api/CLAUDE.md`).
- **Observability**: alle logs gaan naar stdout/stderr → de cluster-logging/SIEM vangt ze op.

### Troubleshooting

| Symptoom | Oorzaak / fix |
|---|---|
| Pod `CreateContainerConfigError` | Een `Secret` ontbreekt of mist een sleutel → check stap 3 (`oc describe pod …`). |
| Pod start niet, SCC/`runAsNonRoot`-fout | Verkeerde/oude image → herbouw met de arbitrary-UID-Dockerfile (gid 0, `chmod -R g=u`). |
| API-log: kan niet verbinden met de DB | `wetsanalyse-db-app`-secret bestaat niet → CNPG-cluster nog niet `healthy` (stap 4). |
| CNPG-cluster niet `healthy` | `oc describe cluster wetsanalyse-db` + `oc logs wetsanalyse-db-1` (vaak S3-credentials/endpoint fout). |
| SSE-stream valt na ~60s weg | Route-timeout-annotatie ontbreekt of een tussenliggende proxy buffert → check de Route. |
| Frontend onbereikbaar via Route | NetworkPolicy-routerlabel klopt niet → `oc get ns openshift-ingress --show-labels` en pas `networkpolicy.yaml` aan. |

---

## 8. Alternatief: uitrol via de webconsole (UI)

Wie liever klikt dan `oc` typt, kan dezelfde uitrol via de **OpenShift-webconsole** doen. De objecten
en namen zijn identiek aan het CLI-spoor — je kunt CLI en UI vrij mengen. Algemene ontsnappingsklep:
de **`+` (Import YAML)** rechtsboven accepteert elk manifest uit deze repo.

> De console kan zelf **geen `kustomize build`**. Voor de Kustomize-overlays zijn er daarom twee
> UI-routes (stap 5): GitOps/ArgoCD óf Import YAML van de vooraf gerenderde bundel.

**Perspectief & rechten.** Schakel linksboven naar het **Administrator**-perspectief; je hebt
edit-rechten in de namespace nodig.

1. **Project** — Home → Projects → **Create Project** (i.p.v. `oc new-project`). Selecteer het project
   daarna in de project-dropdown bovenaan.

2. **Secrets** — Workloads → Secrets → **Create → Key/value secret**. Maak dezelfde secrets als in §3,
   met de **exacte sleutelnamen** (die worden de bestandsnamen op `/run/secrets`): voor
   `wetsanalyse-api-secrets` de sleutels `api_tokens`, `admin_tokens`, `wettenbank_token`,
   `llm_api_key`, `llm_config_secret`; verder `wetsanalyse-frontend-secrets`
   (`frontend_api_token`, `frontend_admin_token`), `wettenbank-mcp-secrets` (`mcp_auth_tokens`) en
   `wetsanalyse-db-backup-s3` (`ACCESS_KEY_ID`, `ACCESS_SECRET_KEY`). Sneller gaat het via **Import YAML**:

   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: wetsanalyse-api-secrets
   stringData:
     api_tokens: "client1:<token>"
     admin_tokens: "admin:<admin-token>"
     wettenbank_token: "<mcp-bearer-token>"
     llm_api_key: "<azure-ai-foundry-key>"
     llm_config_secret: "<fernet-master-key>"
   ```

   De **database**-secret (`wetsanalyse-db-app`) maak je niet zelf — die genereert de CNPG-operator
   (stap 4).

3. **Database (CNPG)** — Operators → **Installed Operators** → CloudNativePG → tab *Cluster* →
   **Create Cluster** (formulier of YAML), of plak `components/postgres-cnpg/cluster.yaml` via Import
   YAML (vul eerst de S3-placeholders in). Wacht tot het cluster *healthy* is in de Cluster-weergave;
   onder Workloads → Secrets verschijnt dan automatisch `wetsanalyse-db-app`.

4. **Uitrollen — kies één route:**
   - **A. OpenShift GitOps (ArgoCD)** *(aanrader voor Kustomize; vereist de OpenShift GitOps-operator)* —
     maak in de ArgoCD-UI een **Application**: `repoURL` = deze repo, `path` =
     `deploy/openshift/overlays/<beproeving|managed-prod>`, destination = je namespace. ArgoCD begrijpt
     de Kustomize-overlay native; **Sync** rolt uit en de Argo-UI toont health/sync-status.
   - **B. Import YAML van de gerenderde bundel** *(geen GitOps nodig)* — download het release-artifact
     `wetsanalyse-openshift-<versie>.tar.gz` (door de `openshift-package`-workflow opgeleverd, zie Fase 3),
     pak `rendered/<beproeving|managed-prod>.yaml` uit en plak dat via de console **Import YAML**. Dat is
     één samengevoegd, op image-digests gepind manifest dat de console direct toepast. (Heb je geen
     artifact, dan kan iemand met `kustomize build deploy/openshift/overlays/<env> > rendered.yaml` het
     bestand lokaal genereren.)

5. **Verifiëren** — schakel naar het **Developer**-perspectief → **Topology**: je ziet de drie workloads
   + de database; het Route-icoon op de frontend opent de app. De Route-URL staat ook onder
   Networking → **Routes**. Pod-logs/terminal open je via de pod in Topology. Doe daarna dezelfde
   end-to-end-checks als in §6.

6. **Beheer & onderhoud** — Workloads → Deployments → kebab-menu → **Restart rollout** (na een image-update of
   secret-rotatie); ConfigMap/Secret bewerken onder Workloads; schalen via de replica-controls op de
   Deployment (let op: in managed-prod stuurt de **HPA** het aantal replica's).
