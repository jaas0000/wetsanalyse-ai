# Wetsanalyse — Wet op de zorgtoeslag, artikel 2

**Methode:** Wetsanalyse (Ausems, Bulles & Lokin), op basis van het Juridisch Analyseschema (JAS).
**Uitgevoerde activiteiten:** Activiteit 2 (markeren en classificeren van wetsformuleringen in JAS-klassen) en Activiteit 3 (vaststellen van begrippen en afleidingsregels).

**Bron:** Wet op de zorgtoeslag (BWB-id `BWBR0018451`), artikel 2, versiedatum 2026-01-01.
**Bronreferentie:** `jci1.3:c:BWBR0018451&artikel=2`
**Aanvullende bron voor begripsbepalingen:** artikel 1 (`jci1.3:c:BWBR0018451&artikel=1`).

> Scope-opmerking: dit rapport analyseert artikel 2. De begripsbepalingen uit artikel 1 worden gebruikt voor de duiding van de in artikel 2 voorkomende begrippen, maar worden niet zelf als afzonderlijke bepaling geclassificeerd.

---

## 0. Letterlijke wettekst (referentie)

| Lid | Tekst (verkort weergegeven) |
|-----|------------------------------|
| 1 | Indien de normpremie voor een verzekerde in het berekeningsjaar minder bedraagt dan de standaardpremie in dat jaar, heeft de verzekerde aanspraak op een zorgtoeslag ter grootte van dat verschil. Voor een verzekerde met een partner wordt tweemaal de standaardpremie in aanmerking genomen; verzekerde en partner worden geacht gezamenlijk één aanspraak te hebben. |
| 2 | De normpremie bedraagt een percentage van het drempelinkomen, vermeerderd met een percentage van het toetsingsinkomen voor zover dat het drempelinkomen te boven gaat. Voor een verzekerde met partner: gezamenlijk toetsingsinkomen. |
| 3 | Percentages: met partner 4,289% van drempelinkomen + 13,730% van toetsingsinkomen boven drempelinkomen; zonder partner 1,912% + 13,730%. Wijzigbaar bij AMvB. |
| 4 | In afwijking van lid 1: bij een partner die geen verzekerde is, bedraagt de aanspraak 50% van het op grond van lid 1 berekende bedrag. |
| 5 | De aanspraak wordt voor iedere kalendermaand afzonderlijk bepaald. |
| 6 | Bij ministeriële regeling kunnen nadere regels worden gesteld omtrent lid 5. |
| 7 | Voorhangprocedure: voordracht voor AMvB krachtens lid 3 niet eerder dan twee weken na overlegging ontwerp aan beide kamers. |

---

## 1. Activiteit 2 — Markeren en classificeren van wetsformuleringen

Per lid worden de wetsformuleringen gemarkeerd en geclassificeerd in JAS-klassen. Gebruikte JAS-klassen:

- **Rechtssubject** — de drager van rechten/plichten (hier: de verzekerde, de partner, Onze Minister, de regelgever).
- **Rechtsobject** — datgene waarover de rechtsbetrekking gaat (hier: de zorgtoeslag / het bedrag).
- **Rechtsbetrekking** — de juridische relatie tussen subject en object (hier: de aanspraak).
- **Rechtsfeit** — feit dat een rechtsgevolg in het leven roept.
- **Voorwaarde (toepassingsvoorwaarde)** — voorwaarde waaronder het rechtsgevolg intreedt.
- **Rechtsgevolg** — het door de norm verbonden gevolg (ontstaan/omvang van de aanspraak).
- **Afleidingsregel / operationalisering** — rekenkundige of definitorische bepaling van een grootheid.
- **Variabele / grootheid (gegeven)** — meetbare grootheid die in de berekening wordt gebruikt.
- **Delegatiebepaling / bevoegdheid** — grondslag voor lagere regelgeving.
- **Procedurele norm** — bepaling over de totstandkoming van regelgeving.
- **Tijdsbepaling / temporele afbakening** — afbakening van de periode waarover wordt bepaald.

### Lid 1 — Ontstaan en omvang van de aanspraak

| # | Wetsformulering (citaat) | JAS-klasse | Toelichting |
|---|---------------------------|------------|-------------|
| 1.1 | "Indien de normpremie voor een verzekerde in het berekeningsjaar minder bedraagt dan de standaardpremie in dat jaar" | Voorwaarde (toepassingsvoorwaarde) | Conditionele voorwaarde: `normpremie < standaardpremie`. Vervulling triggert het rechtsgevolg. |
| 1.2 | "de verzekerde" | Rechtssubject | Gerechtigde tot de aanspraak. |
| 1.3 | "heeft ... aanspraak op een zorgtoeslag" | Rechtsbetrekking | Aanspraak (subjectief recht) van de verzekerde jegens de overheid (uitvoerder). |
| 1.4 | "een zorgtoeslag" | Rechtsobject | Object van de aanspraak (tegemoetkoming; zie art. 1 lid 1 onder e). |
| 1.5 | "ter grootte van dat verschil" | Rechtsgevolg + afleidingsregel | Bepaalt de hoogte: `zorgtoeslag = standaardpremie − normpremie`. |
| 1.6 | "Voor een verzekerde met een partner wordt daarbij tweemaal de standaardpremie in aanmerking genomen" | Afleidingsregel (variant) | Berekeningsvariant: bij partner telt `2 × standaardpremie`. |
| 1.7 | "een verzekerde met een partner" | Rechtssubject (gekwalificeerd) | Subcategorie van rechtssubject; conditioneert de berekeningsvariant. |
| 1.8 | "worden de verzekerde en zijn partner ... geacht gezamenlijk één aanspraak te hebben" | Rechtsbetrekking (fictie) | Juridische fictie: één gezamenlijke aanspraak i.p.v. twee. |

### Lid 2 — Definitie/berekening normpremie (hoofdregel)

| # | Wetsformulering (citaat) | JAS-klasse | Toelichting |
|---|---------------------------|------------|-------------|
| 2.1 | "De normpremie bedraagt een percentage van het drempelinkomen ... vermeerderd met een percentage van het toetsingsinkomen ... voorzover dat ... het drempelinkomen te boven gaat" | Afleidingsregel (operationalisering) | Berekening normpremie: `p1 × drempelinkomen + p2 × max(0; toetsingsinkomen − drempelinkomen)`. Percentages worden in lid 3 ingevuld. |
| 2.2 | "het drempelinkomen" | Variabele / grootheid | Gedefinieerd in art. 1 lid 1 onder f. |
| 2.3 | "het toetsingsinkomen van de verzekerde" | Variabele / grootheid | Inkomensgrootheid (ontleend aan de Awir; zie §3). |
| 2.4 | "in het berekeningsjaar" / "in dat jaar" | Tijdsbepaling | Temporele afbakening van de grootheden. |
| 2.5 | "Voor een verzekerde met een partner wordt ... het gezamenlijke toetsingsinkomen in aanmerking genomen" | Afleidingsregel (variant) | Bij partner: `toetsingsinkomen = gezamenlijk toetsingsinkomen`. |

### Lid 3 — Percentages (parameters)

| # | Wetsformulering (citaat) | JAS-klasse | Toelichting |
|---|---------------------------|------------|-------------|
| 3.1 | "voor verzekerden met een partner vastgesteld op 4,289% van het drempelinkomen, vermeerderd met 13,730% van het toetsingsinkomen voor zover dat boven het drempelinkomen uitgaat" | Afleidingsregel (parameterinvulling) | Concrete percentages met partner: `p1 = 4,289%`, `p2 = 13,730%`. |
| 3.2 | "voor een verzekerde zonder partner op 1,912% van het drempelinkomen, vermeerderd met 13,730% ..." | Afleidingsregel (parameterinvulling) | Concrete percentages zonder partner: `p1 = 1,912%`, `p2 = 13,730%`. |
| 3.3 | "Deze percentages kunnen bij algemene maatregel van bestuur worden gewijzigd." | Delegatiebepaling (bevoegdheid) | Grondslag voor wijziging bij AMvB. Maakt de percentages tot dynamische parameters. |

### Lid 4 — Afwijkende aanspraak bij niet-verzekerde partner

| # | Wetsformulering (citaat) | JAS-klasse | Toelichting |
|---|---------------------------|------------|-------------|
| 4.1 | "In afwijking van het eerste lid" | Verwijzing / uitzonderingsmarkering | Stelt deze regel boven de hoofdregel van lid 1 (lex specialis). |
| 4.2 | "voor een verzekerde met een partner die geen verzekerde is" | Voorwaarde + gekwalificeerd rechtssubject | Voorwaarde: partner is geen verzekerde. |
| 4.3 | "bedraagt de aanspraak op een zorgtoeslag ... vijftig procent van het op grond van het eerste lid berekende bedrag" | Rechtsgevolg + afleidingsregel | `aanspraak = 50% × (bedrag volgens lid 1)`. |

### Lid 5 — Tijdvak van bepaling

| # | Wetsformulering (citaat) | JAS-klasse | Toelichting |
|---|---------------------------|------------|-------------|
| 5.1 | "De aanspraak op een zorgtoeslag wordt voor iedere kalendermaand afzonderlijk bepaald." | Afleidingsregel / tijdsbepaling | Het berekeningstijdvak is de kalendermaand; de aanspraak wordt per maand vastgesteld. |

### Lid 6 — Delegatie nadere regels

| # | Wetsformulering (citaat) | JAS-klasse | Toelichting |
|---|---------------------------|------------|-------------|
| 6.1 | "Bij regeling van Onze Minister kunnen omtrent het bepaalde in het vijfde lid nadere regels worden gesteld." | Delegatiebepaling (bevoegdheid) | Grondslag voor ministeriële regeling bij lid 5. "Onze Minister" = Minister van VWS (art. 1 lid 1 onder a). |

### Lid 7 — Voorhangprocedure

| # | Wetsformulering (citaat) | JAS-klasse | Toelichting |
|---|---------------------------|------------|-------------|
| 7.1 | "De voordracht voor een krachtens het derde lid vast te stellen algemene maatregel van bestuur wordt niet eerder gedaan dan twee weken nadat het ontwerp aan beide kamers der Staten-Generaal is overgelegd." | Procedurele norm (voorhang) | Gecontroleerde delegatie: voorhangtermijn van twee weken bij de AMvB van lid 3. |

---

## 2. Activiteit 3 — Begrippen en afleidingsregels

### 2.1 Begrippen (objecttypen / variabelen)

Onderscheiden worden: in artikel 1 gedefinieerde begrippen, in artikel 2 zelf voorkomende begrippen, en elders (Awir/Zvw) gedefinieerde begrippen.

| Begrip | Definitiebron | Omschrijving | Type |
|--------|---------------|--------------|------|
| verzekerde | art. 1 lid 1 onder c (verwijst naar Zvw art. 1 onder f e.a.) | De verzekeringsplichtige persoon vanaf de eerste dag van de maand na zijn 18e verjaardag; met uitzonderingen. | Rechtssubject |
| partner | (niet in art. 1/2 gedefinieerd) | Partnerbegrip volgt uit de Awir (art. 3 Awir). Afleidingsgegeven voor varianten in lid 1, 2 en 4. | Rechtssubject (relationeel) |
| zorgtoeslag | art. 1 lid 1 onder e | Tegemoetkoming in de premie (resp. bestuursrechtelijke premie) en in het verplicht eigen risico. | Rechtsobject |
| standaardpremie | art. 1 lid 1 onder g (verwijst naar art. 4) | Het op grond van art. 4 vastgestelde bedrag. | Variabele (parameter) |
| normpremie | art. 1 lid 1 onder h; berekend in art. 2 lid 2–3 | De aan de hand van drempel- en toetsingsinkomen berekende premie. | Afgeleide variabele |
| drempelinkomen | art. 1 lid 1 onder f | 108% van het twaalfvoud van het minimumloonbedrag (WML art. 8 lid 1 onder b) per maand januari berekeningsjaar. | Variabele (afgeleid) |
| toetsingsinkomen | (niet in art. 1 gedefinieerd) | Inkomensbegrip uit de Awir (art. 8 Awir). | Variabele (invoer) |
| gezamenlijk toetsingsinkomen | art. 2 lid 2 | Som van de toetsingsinkomens van verzekerde en partner. | Afgeleide variabele |
| berekeningsjaar | (niet in art. 1/2 gedefinieerd) | Het kalenderjaar waarover de aanspraak wordt berekend (Awir-begrip). | Tijdsgrootheid |
| Onze Minister | art. 1 lid 1 onder a | De Minister van Volksgezondheid, Welzijn en Sport. | Rechtssubject (bevoegd gezag) |
| percentage p1 (drempelpercentage) | art. 2 lid 3 | 4,289% (met partner) of 1,912% (zonder partner); wijzigbaar bij AMvB. | Parameter |
| percentage p2 (inkomenspercentage) | art. 2 lid 3 | 13,730% (beide gevallen); wijzigbaar bij AMvB. | Parameter |
| aanspraak (op zorgtoeslag) | art. 2 lid 1 | Subjectief recht op uitbetaling van het verschil. | Rechtsbetrekking |

### 2.2 Afleidingsregels

De afleidingsregels worden expliciet en in onderlinge samenhang weergegeven (van invoer naar resultaat). Notatie: `max(0; x)` voor "voor zover boven".

**AR-1 — Drempelinkomen** (art. 1 lid 1 onder f)
```
drempelinkomen = 1,08 × 12 × (WML-maandbedrag januari berekeningsjaar, art. 8 lid 1 onder b WML)
```

**AR-2 — Toetsingsinkomen in aanmerking te nemen** (art. 2 lid 2, tweede zin)
```
ALS verzekerde een partner heeft:
    toetsingsinkomen_in_aanmerking = toetsingsinkomen_verzekerde + toetsingsinkomen_partner   (gezamenlijk)
ANDERS:
    toetsingsinkomen_in_aanmerking = toetsingsinkomen_verzekerde
```

**AR-3 — Percentages** (art. 2 lid 3; wijzigbaar bij AMvB, lid 3 slotzin)
```
ALS verzekerde een partner heeft:
    p1 = 4,289% ;  p2 = 13,730%
ANDERS:
    p1 = 1,912% ;  p2 = 13,730%
```

**AR-4 — Normpremie** (art. 2 lid 2, met percentages uit AR-3)
```
normpremie = p1 × drempelinkomen
           + p2 × max(0; toetsingsinkomen_in_aanmerking − drempelinkomen)
```

**AR-5 — In aanmerking te nemen standaardpremie** (art. 2 lid 1, tweede zin)
```
ALS verzekerde een partner heeft:
    standaardpremie_in_aanmerking = 2 × standaardpremie
ANDERS:
    standaardpremie_in_aanmerking = 1 × standaardpremie
```

**AR-6 — Voorwaarde voor de aanspraak** (art. 2 lid 1, eerste zin)
```
aanspraak bestaat  DAN EN SLECHTS DAN ALS  normpremie < standaardpremie_in_aanmerking
(bij vervulde voorwaarde is het toeslagbedrag positief; anders geen zorgtoeslag)
```

**AR-7 — Basisbedrag van de aanspraak** (art. 2 lid 1)
```
basisbedrag = standaardpremie_in_aanmerking − normpremie     (alleen voor zover positief)
```

**AR-8 — Correctie bij niet-verzekerde partner** (art. 2 lid 4, "in afwijking van lid 1")
```
ALS verzekerde een partner heeft die geen verzekerde is:
    zorgtoeslag_jaar = 50% × basisbedrag
ANDERS:
    zorgtoeslag_jaar = basisbedrag
```

**AR-9 — Toedeling per kalendermaand** (art. 2 lid 5)
```
De aanspraak wordt voor iedere kalendermaand afzonderlijk bepaald.
(maandbedrag = de per kalendermaand vastgestelde aanspraak; nadere regels mogelijk bij
 ministeriële regeling op grond van lid 6)
```

**AR-10 — Gezamenlijke aanspraak (fictie)** (art. 2 lid 1, slotzin)
```
ALS verzekerde een partner heeft:
    verzekerde en partner hebben gezamenlijk één (1) aanspraak (geen twee afzonderlijke).
```

### 2.3 Beslis-/berekeningsvolgorde (samenvattend)

1. Bepaal of er een partner is (Awir) en of die partner verzekerde is (AR-2, AR-3, AR-5, AR-8).
2. Bepaal `drempelinkomen` (AR-1) en `toetsingsinkomen_in_aanmerking` (AR-2).
3. Bepaal percentages `p1`, `p2` (AR-3).
4. Bereken `normpremie` (AR-4).
5. Bepaal `standaardpremie_in_aanmerking` (AR-5).
6. Toets de voorwaarde `normpremie < standaardpremie_in_aanmerking` (AR-6). Zo niet: geen aanspraak.
7. Bereken `basisbedrag` (AR-7).
8. Pas eventueel de 50%-correctie toe (AR-8).
9. Bepaal de aanspraak per kalendermaand (AR-9), als één gezamenlijke aanspraak bij partner (AR-10).

---

## 3. Externe verwijzingen en aannames (traceerbaarheid)

| Begrip/verwijzing | Vindplaats | Status in deze analyse |
|-------------------|------------|------------------------|
| verzekerde | art. 1 lid 1 onder c → Zvw art. 1 onder f, 68b lid 5, 69; uitz. art. 24 | Overgenomen uit art. 1; onderliggende Zvw-artikelen niet verder ontleed (buiten scope). |
| zorgtoeslag | art. 1 lid 1 onder e → Zvw art. 18d/18e, 19 | Overgenomen uit art. 1. |
| drempelinkomen | art. 1 lid 1 onder f → WML art. 8 lid 1 onder b | Overgenomen uit art. 1 (AR-1). |
| standaardpremie | art. 1 lid 1 onder g → art. 4 Wzt | Verwijst naar art. 4 (niet in scope; waarde als parameter behandeld). |
| toetsingsinkomen | niet in art. 1/2 | **Aanname:** begrip uit de Algemene wet inkomensafhankelijke regelingen (Awir, art. 8). Niet aangeleverd; als invoervariabele behandeld. |
| partner | niet in art. 1/2 | **Aanname:** partnerbegrip uit de Awir (art. 3). Als relationeel rechtssubject behandeld. |
| berekeningsjaar | niet in art. 1/2 | **Aanname:** Awir-begrip (kalenderjaar van berekening). |

> Deze aannames zijn expliciet gemaakt omdat de betreffende begrippen in artikel 2 worden gebruikt maar niet in de aangeleverde artikelen (1 en 2) zijn gedefinieerd. Voor een volledige operationalisering zijn de Awir-definities en artikel 4 Wzt nodig.

---

## 4. Observaties en aandachtspunten

- **Voorwaardelijke aanspraak (lid 1):** de zorgtoeslag bestaat alleen als de (in aanmerking te nemen) standaardpremie de normpremie overstijgt; het toeslagbedrag is exact het positieve verschil.
- **Partnerafhankelijke varianten:** het partnerschap werkt door op drie plaatsen — de standaardpremie (×2, AR-5), het toetsingsinkomen (gezamenlijk, AR-2) en de percentages (AR-3) — en leidt tot één gezamenlijke aanspraak (fictie, AR-10).
- **Lex specialis lid 4:** "in afwijking van het eerste lid" plaatst de 50%-regel boven de hoofdregel; van belang is het onderscheid tussen "partner" (algemeen) en "partner die geen verzekerde is".
- **Dynamische parameters:** de percentages (lid 3) zijn wijzigbaar bij AMvB, met voorhangprocedure (lid 7); de standaardpremie wordt jaarlijks vastgesteld (art. 4). Een uitvoeringssysteem moet deze als jaargebonden parameters behandelen.
- **Tijdvak:** de aanspraak wordt per kalendermaand bepaald (lid 5), terwijl de inkomensgrootheden op jaarbasis (berekeningsjaar) zijn gedefinieerd; nadere regels hierover kunnen bij ministeriële regeling worden gesteld (lid 6).
