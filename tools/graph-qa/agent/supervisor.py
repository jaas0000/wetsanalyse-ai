"""
Supervisor van de juridische agent (vervangt de vroegere QA-router).

De supervisor bepaalt per vraag WELKE worker-agents nodig zijn en in welke volgorde: `antwoord`
(vraag beantwoorden/duiden/definiëren, gegrond op de graaf) of `annotatie` (een artikel/lid volgens
het JAS markeren). Hij mag ketenen (bv. eerst annoteren, dan samenvatten). Retrieval (get_lid/
get_artikel) is een gedeelde tool die de gekozen worker zelf aanroept.

Backward-compatible met het oude router-formaat: een respons met alleen `SPECIALIST:`/`PLAN:` (zonder
`WORKERS:`) wordt gelezen als één `antwoord`-worker met die specialist — zo blijven de bestaande
QA-flows/tests ongewijzigd.
"""
from __future__ import annotations

SUPERVISOR_SYSTEM = (
    "Je bent de supervisor van een juridische agent over een kennisgraaf met Nederlandse wet- en "
    "regelgeving (invordering/belastingen). Bepaal welke agent(s) de vraag nodig heeft en in welke "
    "volgorde. Antwoord in EXACT dit formaat, drie regels:\n"
    "WORKERS: <komma-gescheiden uit: antwoord, annotatie>\n"
    "SPECIALIST: <definitie|duiding|algemeen>\n"
    "PLAN: <1-2 zinnen aanpak, of AFWIJZEN als de vraag niet over de Nederlandse wet- en regelgeving "
    "in de graaf gaat>\n"
    "Kies 'annotatie' als de gebruiker vraagt een ARTIKEL of LID te ANNOTEREN volgens het JAS (de "
    "juridische elementen markeren en classificeren). Kies anders 'antwoord' (een vraag beantwoorden, "
    "duiden of een begrip definiëren) met de passende SPECIALIST: 'definitie' voor begrip-/definitie"
    "vragen, 'duiding' voor betekenis/structuur/samenhang van een bepaling, anders 'algemeen'. "
    "SPECIALIST geldt alleen voor 'antwoord'."
)

_QA_SPECIALISTS = ("definitie", "duiding", "algemeen")


def parse_supervisor(text: str) -> tuple[list[str], str]:
    """(worker_plan, plan). worker_plan is een geordende lijst specialist-namen die de agent-node
    draait: een `antwoord`-worker wordt de gekozen QA-specialist, een `annotatie`-worker wordt
    'annotatie'."""
    workers_raw, qa_specialist, plan = "", "algemeen", ""
    for line in text.splitlines():
        low = line.strip()
        up = low.upper()
        if up.startswith("WORKERS:"):
            workers_raw = low.split(":", 1)[1].strip().lower()
        elif up.startswith("SPECIALIST:"):
            val = low.split(":", 1)[1].strip().lower()
            if val in _QA_SPECIALISTS:
                qa_specialist = val
        elif up.startswith("PLAN:"):
            plan = low.split(":", 1)[1].strip()
    if not plan:
        plan = text.strip()

    workers = [w.strip() for w in workers_raw.split(",") if w.strip()] or ["antwoord"]
    plan_spec = ["annotatie" if w == "annotatie" else qa_specialist for w in workers]
    return plan_spec, plan
