# WetsTaal 1 — Handreiking (Werkversie)

> *De syntax en semantiek van de logisch formele, declaratieve en breed begrijpelijke taal.*

**Werkversie 18 oktober 2024**

| Veld | Waarde |
|---|---|
| Deze versie | https://okubbe.github.io/wetstaal_1_documentatie/ |
| Laatst gepubliceerde versie | https://okubbe.github.io/wetstaal_1_documentatie/v1.0.0 |
| Laatste werkversie | https://okubbe.github.io/wetstaal_1_documentatie/ |
| Vorige versie | https://okubbe.github.io/wetstaal_1_documentatie/v0.0.2 |
| Redacteur | WetsTaal (WetsTaal) |
| Auteurs | Sjir Nijssen (PNA Group); Diederik Dulfer (Belastingdienst); Onno Kubbe (Belastingdienst) |
| Doe mee | GitHub okubbe/wetstaal_1_documentatie — Dien een melding in · Revisiehistorie · Pull requests |
| Licentie | Creative Commons 0 Public Domain Dedication |

**Samenvatting** — *(in de bron leeg gelaten.)*

## Status van dit document

Dit is een werkversie die op elk moment kan worden gewijzigd, verwijderd of vervangen door
andere documenten. Het is geen door het TO goedgekeurde consultatieversie.

> **Conversienoot.** Dit Markdown-bestand is geautomatiseerd afgeleid uit `docs/WetsTaal.pdf`
> (pymupdf4llm + nabewerking). De wettekst en doorgestreepte passages (`~~…~~`) zijn brongetrouw
> overgenomen; diagrammen en invulformulieren stonden in de PDF als afbeelding en zijn hier
> vervangen door hun bijschrift.

## Inhoudsopgave

- § 1. Wetstaal 1
- § 2. Objectief en subjectief recht
- § 3. Rechtssubject
  - § 3.1 Waarom beginnen we met rechtssubject?
  - § 3.2 Wat is een rechtssubject?
  - § 3.3 Voorbeelden van rechtssubjecten
  - § 3.4 Het patroon met 4 gestructureerde gegevens rond rechtssubject, oftewel welke uitdrukkingen van een rechtssubject zijn toegestaan
  - § 3.5 Invulformulier voor rechtssubject
  - § 3.6 Het patroon rond rechtssubject
  - § 3.7 De samenhang tussen patroon en ingevuld formulier voor rechtssubject
  - § 3.8 Kennisweergave in tekst en schemavorm alsmede hun 1:1 connecties voor rechtssubject
- § 4. Rechtsbetrekking in het objectieve recht (wetgeving)
  - § 4.1 Wat is een rechtsbetrekking, oftewel de semantiek?
  - § 4.2 Welke uitdrukkingen over rechtsbetrekkingen zijn toegestaan, oftewel de syntax?
  - § 4.3 Elke rechtsbetrekking in het objectieve recht krijgt een identificatie toegewezen
  - § 4.4 Hoofdsoort van de rechtsbetrekking
  - § 4.5 De ondersoort van de rechtsbetrekking
  - § 4.6 Het voordeel-houdende rechtssubject en het nadeel-houdende rechtssubject aanwijzen of toevoegen
  - § 4.7 Een rechtsbetrekking heeft altijd een rechtsobject of voorwerp
  - § 4.8 Een rechtsbetrekking is altijd gebonden aan een voorwaarde
  - § 4.9 Tussentijdse samenvatting
  - § 4.10 Het patroon met negen gestructureerde gegevens rond rechtsbetrekking
  - § 4.11 Invulformulier voor rechtsbetrekking
  - § 4.12 Het patroon rond rechtsbetrekking
  - § 4.13 De samenhang tussen patroon en ingevuld formulier bij rechtsbetrekking
- § 5. Rechtsfeit (juridische toestandsveranderaar)
- § 6. Rechtsgevolgen (toestandsverandering)
- § 7. Rechtsobject
- § 8. Juridisch relevant feit in het objectieve en subjectieve recht
- § 9. Juridische toestand
- § 10. Afleidingsregel
- § 11. Voorwaarde
- § 12. Variabele en waarde
- § 13. Juridisch scenario met juridische aktes
- § 14. Begrippenlijst
- § 15. Conformiteit
- § 16. Lijst met figuren
- § A. Index
  - § A.1 Begrippen gedefinieerd door deze specificatie
  - § A.2 Begrippen gedefinieerd door verwijzing

## § 1. Wetstaal 1

Het belang van Wetsanalyse ter bevordering van wendbare wetsuitvoering alsmede voor het opstellen van wendbare wetgeving wordt in Nederland steeds breder onderkend. In het programma Werk aan Uitvoering neemt toekomstbestendige wet- en regelgeving een centrale plaats in (Zie paragraaf 4.3). In Handelingsperspectieven op bladzijde 6 lezen we (let op, hier is bedoeld doelstelling voor 2030):

Overheidsdienstverlening aan burgers en bedrijven is verschoven van een sterk procesgeoriënteerde ‘one size fits all’ inrichting en aanpak van de publieke dienstverlening, naar een aanpak waarin de behoefte van burgers en bedrijven centraal komt te staan.

## § 2. Objectief en subjectief recht

Bijvoorbeeld een introductie.

NOOT: index

Dit hoofdstuk is toegevoegd met `class="informative"` in `config.js` .

## § 3. Rechtssubject

In dit hoofdstuk gaan we de semantische (wat betekent een term?) en syntactische regels (welke uitdrukkingen met deze term zijn toegestaan?) beschrijven van het onderdeel Rechtssubject van de logisch formele, declaratieve en breed begrijpelijke taal met de naam WetsTaal. Met deze taal worden voor zowel de wetgeving als de wetsuitvoering logisch formele modellen opgesteld waarmee de wetsuitvoering vanaf het prille begin van het wetgevingsproces getest kan worden.

Dat betekent dat wetgeving op die manier opgesteld, volledig is, breed begrijpelijk en waarbij de computer effectief kan worden ingeschakeld om de complexiteit te minimaliseren en de wetgeving aangevuld met ontbrekende gegevens toegevoegd in het multidisciplinaire team op basis van de patronen in WetsTaal en daardoor de bedoelde wetgeving volledig te expliciteren in het wetgevingsmodel. De taal is een zogenaamde gecontroleerde natuurlijke taal. Dat betekent zowel begrijpelijk voor de meerderheid van de mensen als computers.

Beide beschrijvingen, zowel van de syntax (welke uitdrukkingen zijn toegestaan?) als de semantiek (wat betekent een term?) spelen een belangrijke rol bij wetgeving en wetsanalyse op basis van patroonherkenning, zoals ook in een aantal andere exacte wetenschappen met groot succes wordt gebruikt. Bij die patroonherkenning willen we bewust een stuk overtolligheid inbouwen om in situaties waarin meer dan een enkel gestructureerd gegeven in de juridische bron ontbreekt, de patroonherkenning nog steeds effectief en snel te laten werken.

### § 3.1 Waarom beginnen we met rechtssubject?

De structuur van wetgeving die sinds 2012 steeds meer in kaart is gebracht, anders gezegd is gemodelleerd in een logisch formeel, declaratief en breed begrijpelijk model, laat zien dat rechtssubject als eerste vereist is om andere fundamentele begrippen of bouwblokken van wetgeving en wetsuitvoering zoals rechtsbetrekking, rechtsfeit en rechtsgevolg adequaat te kunnen beschrijven.

De structuur van wetgeving is sinds 2012 steeds meer bloot gelegd op basis van het modelleren van de :

begripsomschrijvingen,

gegevens,

- regels, en

processen.

Hierbij is voor elke term gebruikt in gegevens, regels of processen die in het multidisciplinaire team niet als glashelder kan worden aangeduid voor de meerderheid van de Nederlanders, een begripsomschrijving opgesteld. Deze structuur blijkt behoorlijk krachtig te zijn. Door die kracht volledig te expliciteren, kan deze kennis gebruikt worden tijdens alle stappen van het wetgevingsen wetsuitvoeringsproces.

Die structuur is tot nu toe onvoldoende en vaak geheel niet beschreven in de leerboeken Inleiding Rechtsgeleerdheid. Vanuit dat perspectief is het heel goed te verklaren waarom er zo veel misgaat in wetsuitvoering dat zelfs de eerste minister het woord schande gebruikt.

Het niet bewust zijn van die structuur in de leerboeken voor het opstellen van wetgeving kan aangemerkt worden als d voornaamste oorzaak van de problemen in de wetsuitvoering. Maar de wetgevingsjuristen zijn eigenlijk ook slachtoffer van het feit dat zij tijdens hun opleiding niet bekend gemaakt zijn met kennisanalysetechnieken en de onderliggende structuur van wetgeving. Zou dat wel het geval zijn, dan is de verwachting dat de kwaliteit van wetgeving structureel veel hoger zou liggen.

### § 3.2 Wat is een rechtssubject?

De begripsdefinitie van de term rechtssubject:

Een rechtssubject is

de drager van rechten en plichten, en/of

- de generator van juridisch relevante feiten, en/of

- de uitvoerder van rechtshandelingen en feitelijke handelingen met rechtsgevolg.

### § 3.3 Voorbeelden van rechtssubjecten

In onderstaand diagram zijn een aantal voorbeelden van rechtssubjecten gegeven die bij veel Nederlanders bekend zijn.

> **Figuur 1 voorbeelden van rechtssubjecten** — *afbeelding niet overgenomen uit de PDF.*

In bovenstaand diagram is onder meer ook het volgende uitgebeeld:

Het rechtssubjecttype buitenlandsbelastingplichtige voor de inkomstenbelasting is een deelverzameling van het rechtssubjecttype natuurlijke persoon. Het rechtssubjecttype natuurlijke persoon en een deelverzameling van het rechtssubjecttype rechtssubject.

Verder kunnen we de volgende feiten uit het diagram in tekst omzetten:

Andre Rieu, Max Verstappen en ASML zijn voorbeelden van bekende Nederlandse rechtssubjecten. Andre Rieu en Max Verstappen zijn ook voorbeelden van de specialisatie van rechtssubject, met de naam natuurlijk persoon. ASML is een voorbeeld van de specialisatie van rechtssubject met de naam rechtspersoon. Andre Rieu is een binnenlandsbelastingplichtige voor de inkomstenbelasting. Waarom is dat zo? Omdat Andre Rieu in Nederland woont. (IB 2.1, a) Max Verstappen is een buitenlandse belastingplichtige voor de inkomstenbelasting. Waarom is dat zo? Omdat Max Verstappen in het buitenland woont maar wel Nederlands inkomen geniet. (Wet op de Inkomstenbelasting artikel 2.1,b).

Het voorgaande is duidelijk een verrijking van het begrip van Wet op de inkomstenbelasting artikel 2.1. Maar op welk niveau speelt dit? Dat is het abstracte niveau van wetgeving, waarbij –

stilzwijgend – verzuimd is expliciet aan te geven dat hier het perspectief van een bepaald moment of periode in de tijd bedoeld is. Dat is wat genoemd wordt het objectieve recht. Het objectieve recht is het recht beschreven in wetgeving. Maar dat is niet het perspectief van de burger. In zijn concrete belevingswereld heeft hij expliciet rekening te houden met perioden en momenten in de tijd. Dat is het subjectieve recht, het recht gezien vanuit het perspectief van de burger of bedrijf.

### § 3.4 Het patroon met 4 gestructureerde gegevens rond rechtssubject, oftewel welke uitdrukkingen van een rechtssubject zijn toegestaan

Het patroon van gestructureerde gegevens rond rechtssubject hebben we nodig om adequaat antwoord te kunnen geven op de twee vragen van de burger:

- voor wie zijn deze plichten bedoeld?

- voor wie zijn deze rechten bedoeld?

We zullen dat eerst toelichten aan de hand van het concrete geval van het voetgangerslicht, te weten artikel 74, lid 1, onder c, 1e zin:

**Artikel 74**

1. Bij voetgangerslichten betekent:

   - ~~a. groen licht: voetgangers mogen oversteken;~~

   - ~~b. groen knipperend licht: voetgangers mogen oversteken; het rode licht verschijnt spoedig;~~

   - c. rood licht: voetgangers mogen niet meer beginnen over te steken; reeds overstekende voetgangers moeten zo snel mogelijk doorlopen.

We zien in bovenstaande tekst dat we te doen hebben met twee verschillende specialisaties van rechtssubjecten bij het voetgangerslicht:

- voetgangers op het trottoir of voetpad bij een voetgangerslicht en

- reeds overstekende voetgangers bij een voetgangerslicht.

We zullen hierna laten zien hoe dat bij Wetsanalyse o.b.v. de regels van WetsTaal deze twee soorten rechtsbetrekkingen expliciet naar voren komen in het model voor RVV, artikel 74, lid 1.

Van een rechtssubject noteren we 4 gestructureerde gegevens in de vulling van het wetsmodel, de concrete wereld van de burger.

Dat is:

- de identificatie van een rechtssubject, naar keuze in de vorm van

   - een korte code of

een langere naam, of

beide

- de specialisatie van een rechtssubject en het bovenliggende rechtssubject waarvan dit rechtssubject een specifieke categorie is. Voorbeeld: een natuurlijk persoon is een rechtssubject van vlees en bloed.

de voorwaarde waaronder het rechtssubject behoort tot de specifieke categorie. Voorbeeld: een voetganger (een rechtssubject) is een natuurlijk persoon (een rechtssubject) die aan het verkeer deelneemt.

### § 3.5 Invulformulier voor rechtssubject

Hieronder ziet u de invulling van een formulier voor het geval van een voetganger die op het trottoir of voetpad staat bij een Voetgangerslicht.

In dit geval is het eerste gestructureerde gegeven van een rechtssubject de identificatie:

Binnen de collectie van alle rechtssubjecten binnen RVV art 74 lid 1 identificeert voetganger op het trottoir bij een voetgangerslicht een specifiek rechtssubject. Hier is de langere naam als identificatie voor rechtssubject gebruikt. Er had ook gekozen kunnen worden hier binnen het kennisdomein Voetgangerslicht deze twee rechtssubjecten aan te duiden met de korte code als RS01 en RS02.

Het derde gestructureerde gegeven van een rechtssubject bevat het feit welk rechtssubject is specialisatie van een hoger rechtssubject in de boom van rechtssubjecten. In dit concrete geval hebben we:

Rechtssubject met de naam Voetganger op het trottoir of voetpad bij een voetgangerslicht is een specialisatie van rechtssubject met de naam voetganger.

Het vierde gestructureerde gegeven van een rechtssubject is de voorwaarde waaronder de specialisatie geldig is. In dit concrete geval hebben we als vierde gestructureerde gegeven:

De voorwaarde op de specialisatie van het rechtssubject voetganger op het trottoir of voetpad bij een voetgangerslicht is geldig indien voldaan is aan de voorwaarde Voetganger bevindt zich op het trottoir of voetpad bij een voetgangerslicht.

In onderstaand formulier zijn 5 gestructureerde gegevens ingevuld bij een rechtssubject, het vijfde is de bron. Het ter beschikking hebben van het gestructureerde gegeven Bron helpt om met krachtige ondervraagtalen effectief te kunnen werken bij wetgeving en wetsuitvoering.

> **Figuur 2 Invulformulier rechtssubject I** — *afbeelding niet overgenomen uit de PDF.*

Het tweede voorbeeld van een rechtssubject dat voorkomt in RVV, art 74, lid is hieronder ingevuld in een invulformulier voor Rechtssubject. Men zou kunnen dat er twee gegevens records zijn gebruikt om de volledig geëxpliciteerde kennis te kunnen borgen van de twee van de drie rechtssubjecten in RVV, art 74, lid 1. Wie is het derde Rechtssubject? Dat staat niet in RVV, art 74, lid 1. Dat heeft het multidisciplinaire team op basis van de patronen van WetsTaal na beraad toegevoegd. En dat is de Staat.

> **Figuur 3 Invulformulier rechtssubject II** — *afbeelding niet overgenomen uit de PDF.*

De hierboven ingevulde formulieren laten de 5 gestructureerde gegevens zien van een rechtssubject.

### § 3.6 Het patroon rond rechtssubject

Het patroon rond rechtssubject is op grammaticaal niveau en dat is veel abstracter dan het concreet ingevulde formulier voor rechtssubject. Het invulformulier bevat een instantiatie of invulling van het patroon. Het patroon is hieronder weergegeven. Hier is het gestructureerde gegeven voor bron weggelaten evenals de twee optionele mogelijkheden om een korte code of langere naam toe te wijzen. M.a.w. in het meest expliciete geval hebben we te doen met 5 gestructureerde gegevens om een rechtssubject volledig declaratief te beschrijven.

> **Figuur 4 Patroon rechtssubject I** — *afbeelding niet overgenomen uit de PDF.*

### § 3.7 De samenhang tussen patroon en ingevuld formulier voor rechtssubject

De ervaring heeft ons geleerd dat het nuttig is om de samenhang van het concrete niveau van de ingevulde gestructureerde gegevens waar de burger direct mee te maken heeft zoals weergegeven in een invulformulier met het abstracte grammaticaal niveau van het patroon van rechtssubject te laten zien. Dat is hieronder weergegeven. Het onderste deel is het patroon, het bovenste deel het ingevulde formulier.

### § 3.8 Kennisweergave in tekst en schemavorm alsmede hun 1:1 connecties voor rechtssubject

Ook is nuttig gebleken om rechtswetenschappelijke kennis zowel in tekst als in schemavorm weer te geven. Over het algemeen is schemavorm een meer productieve vorm. Door twee kennisrepresentaties ter beschikking te stellen hebben de professionals in het MDT keuze.

> **Figuur 5 Patroon rechtssubject II** — *afbeelding niet overgenomen uit de PDF.*

Dit patroon kan worden gebruik tijdens het wetgevingsproces om de feiten over rechtssubject compleet te krijgen vanaf het prille begin. In het wetsanalyse proces worden dezelfde patronen gebruikt om de kennis die nogal eens ontbreekt in wetgeving aan te vullen en alsnog aldus volledig geëxpliciteerd te krijgen.

## § 4. Rechtsbetrekking in het objectieve recht (wetgeving)

### § 4.1 Wat is een rechtsbetrekking, oftewel de semantiek?

Een rechtsbetrekking is een juridische relatie tussen twee rechtssubjecten, waarbij:

   - die relatie komt met een hoofdsoort, en

   - elke hoofdsoort heeft meer ondersoorten,

   - het ene rechtssubject de voordeel-kant heeft en

   - het andere rechtssubject de nadeel-kant,

   - betreffende het rechtsobject en

   - geldig is onder de gespecificeerde voorwaarden.

- 2.1 Voorbeelden van rechtsbetrekkingen

Twee bekende voorbeelden van rechtsbetrekkingen zijn te vinden binnen het kennisdomein voetgangerslicht. In het RVV (Reglement Verkeersregels en Verkeerstekens 1990) lezen we het volgende:

**Artikel 74**

1. Bij voetgangerslichten betekent:

   - a. groen licht: voetgangers mogen oversteken;

   - b. ~~groen knipperend licht: voetgangers mogen oversteken; het rode licht verschijnt spoedig;~~

   - c. rood licht: voetgangers mogen niet meer beginnen over te steken; ~~reeds overstekende~~

   - ~~voetgangers moeten zo snel mogelijk doorlopen.~~

De doorgestreepte stukken tekst vallen buiten de scope van dit deelhoofdstuk.

Om in lijn te blijven met de voorbeelden gegeven onder rechtssubject, wordt het volgende gezegd: We zien in de tekst van artikel 74, lid 1 van het RVV (in het niet doorgestreepte deel) twee rechtsbetrekkingen. Deze rechtsbetrekkingen zouden we kunnen identificeren als:

1. RVV, art. 74, lid 1, onder a en

2. RVV, art. 74, lid 1, onder c, 1e zin.

> **Figuur 6 Rechtsbetrekkingen** — *afbeelding niet overgenomen uit de PDF.*

De verwoording van het hierboven afgebeelde van het objectieve recht is als volgt:

Binnen de collectie van alle rechtssubjecttypen in het objectieve recht binnen het kennisdomein Voetgangerslicht identificeert voetganger bij het voetgangerslicht op het trottoir een specifiek rechtssubjecttype. Binnen de collectie van alle rechtssubjecttypen in het objectieve recht binnen het

kennisdomein Voetgangerslicht identificeert de Staat een specifiek rechtssubjecttype. Het rechtssubjecttype voetganger bij het voetgangerslicht op het trottoir is een specialisatie van het rechtssubjecttype natuurlijke persoon. Het rechtssubjecttype natuurlijke persoon is een specialisatie van het rechtssubjecttype rechtssubject. Het rechtssubjecttype de Staat is een instantie van het rechtssubject rechtspersoon, en dat is een specialisatie van rechtssubject.

U ziet dat een schema heel veel samenhangende kennis bevat. Deze kennis kan volledig weergegeven worden in gestructureerde tekst. Dat is gewoon een andere kijk op exact dezelfde kennis. Maar nu is er keuze en de nieuwe mogelijkheid heel innovatief om te gaan met de gestructureerde weergave. Dat in tegenstelling met de gebruikelijke wettekst waar weinig innovatiefs mee te doen is.

Als tussentijdse samenvatting kunnen we het volgende zeggen: Een rechtsbetrekking kunnen we in een wetsmodel volledig beschrijven door de volgende 9 gestructureerde gegevens op te nemen in het model:

   1. de bron voor deze rechtsbetrekking,

   2. de korte code ter identificatie van de rechtsbetrekking (binnen het betreffende kennisdomein, in dit geval Voetgangerslicht)

   3. de langere naam ter identificatie van de rechtsbetrekking (binnen het betreffende kennisdomein),

   4. de hoofdsoort van de rechtsbetrekking,

   5. de ondersoort van de rechtsbetrekking,

   6. het voordeelhoudend rechtssubject,

   7. het nadeelhoudend rechtssubject,

   8. het rechsobject of voorwerp van de rechtsbetrekking en

   9. de voorwaarde waaronder de rechtsbetrekking geldig is.

### § 4.2 Welke uitdrukkingen over rechtsbetrekkingen zijn toegestaan, oftewel de syntax?

Hierboven zijn de 9 eigenschappen van een rechtsbetrekking beschreven. In een schema kan dit bovenstaand tekstueel patroon als volgt worden weergegeven (let op de bron is hieronder niet weergegeven evenals de twee identificatievormen, waarvan er een optioneel is):

> **Figuur 7 Patroon rechtsbetrekking I** — *afbeelding niet overgenomen uit de PDF.*

### § 4.3 Elke rechtsbetrekking in het objectieve recht krijgt een identificatie toegewezen

Elke rechtsbetrekking krijgt binnen zijn kennisdomein een korte identificatie toegewezen waar bovendien RB als eerste twee karakters optreedt. Daarmee kan in een interactieve mode binnen het kennisdomein heel handig worden geopereerd. Bijv. binnen het kennisdomein RVV art v74, lid 1 geven we de eerste rechtsbetrekking de identificatie RB01.

### § 4.4 Hoofdsoort van de rechtsbetrekking

Aan elke rechtsbetrekking kennen we de hoofdsoort toe. Tevens kennen we voor elke rechtsbetrekking een ondersoort toe. De drie hoofdsoorten zijn:

- Aanspraak – verplichting

- Verlof – geenaanspraak

- Bevoegdheid – gehoudenheid.

Voor de hoofdsoort aanspraak – verplichting geldt dat de verplichting-houder het actieve rechtssubject is. Deze dient een verplichting na te komen; de voordeel-houder heeft een aanspraak op het nakomen van de verplichting.

Voor de hoofdsoort verlof – geenspraak geldt dat het voordeel-houdend rechtssubject het actieve rechtssubject is. Deze heeft het verlof, ook vaak aangeduid als de vrijheid, om al dan niet gebruik te maken van zijn verlof. Denk aan de houder van een rijbewijs. Deze kan gebruik maken van zijn

rijbewijs en dan heeft de geenaanspraakhouder, in dit geval de Staat, het gebruik van het rijbewijs maar te accepteren.

Voor de hoofdsoort bevoegdheid – gehoudenheid geldt dat de voordeel-houder het actieve rechtssubject is. Hij heeft de bevoegdheid een - nieuwe rechtsbetrekking of juridisch relevant feit in het leven te roepen, - een eigenschap van een bestaande rechtsbetrekking of een bestaand juridisch relevant feit te wijzigen, en/of - een bestaande rechtsbetrekking of juridisch relevant feit ten einde te stellen. De gehoudenheidshouder kan hier niets tegen inbrengen.

### § 4.5 De ondersoort van de rechtsbetrekking

Aan elke rechtsbetrekking dienen we ook de ondersoort van de rechtsbetrekking aan te geven. Voor de hoofdsoort aanspraak – verplichting hebben we drie ondersoorten:

- Krachtige aanspraak – fatale verplichting

- Aanspraak na ingebrekestelling – verplichting na ingebrekestelling

- Zwakke aanspraak – zwakke verplichting.

Bij een krachtige aanspraak – fatale verplichting geldt dat, indien de plichthouder zijn plicht niet vervult, de aanspraakhouder meteen de bevoegdheid (een ander soort rechtsbetrekking) krijgt de overtredende plichthouder een sanctie op te leggen (een nieuwe rechtsbetrekking van het soort fatale verplichting, meestal een boete of hogere boete dan de vorige boete).

Bij een aanspraak na ingebrekestelling dient bij niet nakomen van de plicht door de plichthouder de aanspraakhouder de plichthouder eerst in gebreke te stellen. Daardoor wordt de verplichting ‘verhoogd’ tot fatale verplichting.

Bij een zwakke aanspraak – zwakke verplichting heeft de aanspraakhouder, indien de plichthouder verzaakt, niet de bevoegdheid een sanctie op te leggen, of een ingebrekestelling. Wel ontstaat er een juridisch relevant feit dat bij een rechtszaak meegenomen kan worden door de rechter. Een voorbeeld hiervan is bijvoorbeeld artikel 2, lid 4 van de Wet flexibel werken.

Er zijn rechtsbetrekkingen van verlof waarbij een handeling door de recht-houder leidt tot een rechtsfeit. Bijv. bij het verlof eerder te mogen betalen dan de fatale datum van een boete bij het betrapt worden door een bevoegde bij rood licht te beginnen met oversteken vanaf het voetpad of trottoir bij een voetgangerslicht. Het gebruik maken van eerder te mogen betalen dan de fatale datum heeft als formeel logische consequentie dat daarmee voldaan wordt aan de fatale betaalverplichting. Door een rechtsbetrekking van verlof tijdens het opstellen of analyseren van wetgeving een van deze twee ondersoorten toe te kennen in het multidisciplinaire team kunnen overbodige lange gesprekken vermeden worden en kan de kwaliteit van de uitvoering verhoogd worden. De ondersoorten van de hoofdsoort verlof zijn:

Wel rechtsfeitbaar

Niet rechtsfeitbaar

Voor de hoofdsoort bevoegdheid – gehoudenheid hebben we twee ondersoorten, te weten:

- een optionele bevoegdheid en

een verplichte bevoegdheid

Een verplichte bevoegdheid treedt vaak op als de Overheid een rechtsbeginsel dient te respecteren, zoals gelijke behandeling.

### § 4.6 Het voordeel-houdende rechtssubject en het nadeel-houdende rechtssubject aanwijzen of toevoegen

Bij een rechtsbetrekking van de hoofdsoort aanspraak – verplichting is de plichthouder de actieveling. Van de andere twee hoofdsoorten is de recht-houder de actieveling. In wetgeving wordt zelden zowel de ene als de andere kant van een rechtsbetrekking expliciet weergegeven. Meestal wordt de actieveling weergegeven. Hoewel we voor de modelrepresentatie beide rechtssubjecten van een rechtsbetrekking expliciet willen weergeven, is het in een best practice of methode wel handig om eerst de in de wetgeving aangegeven rechtssubject te modelleren. Dat betekent dat in een best practice de volgorde van het vaststellen of toevoegen van de twee betrokken rechtssubjecten voor deze twee gestructureerde feiten verschillend is, afhankelijk van de hoofdsoort, of stapje 4 en dan 5, of stapje 5 en dan 4. Het nadeel-houdende rechtssubject is bij RVV art 74, lid 1 onder c, 1e zin de voetganger op het trottoir of voetpad bij het voetgangerslicht. Het voordeel-houdende rechtssubject in deze rechtsbetrekking is de Staat.

Elke rechtsbetrekking heeft ook een nadeel-houdend rechtssubject. Bij de hoofdsoort verlof en bevoegdheid is die zelden beschreven in wetgeving. In dat geval is het zaak dat het MDT het nadeel-houdende rechtssubject expliciet toevoegt aan het wetgevingsmodel.

### § 4.7 Een rechtsbetrekking heeft altijd een rechtsobject of voorwerp

Kijken we naar de tekst van de regelgeving:

**Artikel 74**

1. Bij voetgangerslichten betekent:

   - a. groen licht: voetgangers mogen oversteken;

   - b. ~~groen knipperend licht: voetgangers mogen oversteken; het rode licht verschijnt spoedig;~~

c. rood licht: voetgangers mogen niet meer beginnen over te steken; ~~reeds overstekende voetgangers moeten zo snel mogelijk doorlopen.~~

‘beginnen over te steken’ is datgene wat niet mag. Dat is het voorwerp van de rechtsbetrekking, oftewel het rechtsobject.

### § 4.8 Een rechtsbetrekking is altijd gebonden aan een voorwaarde

In deze rechtsbetrekking geldt als voorwaarde ‘bij rood voetgangerslicht’. Een voorwaarde heeft betrekking op 1 of meer juridisch relevante feiten. Een juridisch relevant feit is gedefinieerd als een feit dat in een voorwaarde op een rechtssubject, rechtsbetrekking of rechtsfeit voorkomt, of in een rechtsobject, of in een afleidingsregel.

### § 4.9 Tussentijdse samenvatting

Laten we nu eens kijken hoe een aantal gestructureerde gegevens betreffende rechtssubjecten en rechtsbetrekkingen samenhangt.

> **Figuur 8 Patroon rechtsbetrekking II** — *afbeelding niet overgenomen uit de PDF.*

De verwoording van bovenstaande gestructureerde gegevens (vier voorbeelden van relaties tussen een rechtssubject en een rechtsbetrekking) is als volgt: (waarbij we de identificatiefeiten niet herhalen.)

- In de rechtsbetrekking RVV, art. 74, lid 1, onder a heeft het rechtssubjecttype voetganger bij het voetgangerslicht op het trottoir of voetpad de voordeel-kant.

- In de rechtsbetrekking RVV, art. 74, lid 1, onder a heeft het rechtssubjecttype de Staat de nadeel-kant.

- In de rechtsbetrekking RVV, art. 74, lid 1, onder c, 1e zin; heeft het rechtssubjecttype de Staat de voordeel-kant.

- In de rechtsbetrekking RVV, art. 74, lid 1, onder c, 1e zin; heeft het rechtssubjecttype voetganger bij het voetgangerslicht op het trottoir of voetpad de nadeel-kant.

Wat betekent de tekst onder a? Als een voetganger op het trottoir of voetpad staat bij een voetgangerslicht en het licht is groen, dan heeft de voetganger de voordeel-kant in de rechtsbetrekking om te mogen oversteken en de Staat heeft de nadeel-kant, met de mooie term geenaanspraak. Dit is een rechtsbetrekking van het soort verlof. De Staat heeft de beslissing van de voetganger maar te accepteren, of hij nu oversteekt of prefereert op het trottoir of voetpad te blijven staan.

Wat betekent de tekst onder c, eerste zin? Als een voetganger op het trottoir of voetpad staat bij een voetgangerslicht en het licht is rood, dan heeft de voetganger de nadeel-kant in de rechtsbetrekking niet meer beginnen over te steken en de Staat heeft de voordeel-kant met de mooie term krachtige aanspraak. Dit is een rechtsbetrekking van het soort fatale verplichting. De voetganger krijgt bij overtreding en vaststelling door een daartoe bevoegde, een flinke geldboete van het CJIB (Centraal Justitieel Incasso Bureau), en niet eerst een vriendelijke waarschuwing. En wat is het rechtsobject van deze rechtsbetrekking? Beginnen over te steken.

En wat is de voorwaarde bij deze rechtsbetrekking? Dat het voetgangerslicht op groen staat. We kunnen hier nog nuttig een afgeleid feit aan toevoegen: wie is het actieve rechtssubject in deze rechtsbetrekking? Dat is de voetganger op het trottoir bij een voetgangerslicht. Als we bovenstaande soorten feiten noteren van de tweede rechtsbetrekking (RVV, art. 74, lid, onder c, 1e zin, krijgen we de volgende reeks:

1. De rechtsbetrekking krijgt de identificatie RB01 binnen het kennisdomein voetgangerslicht.

2. Het is een rechtsbetrekking van de hoofdsoort verplichting.

3. Het is een rechtsbetrekking van de ondersoort fatale verplichting.

4. Het nadeel-houdend rechtssubject is de voetganger op het trottoir of voetpad bij een voetgangerslicht.

5. Het voordeel-houdend rechtssubject is de Staat.

6. Het rechtsobject van deze rechtsbetrekking is beginnen over te steken.

7. De voorwaarde bij deze rechtsbetrekking is dat het voetgangerslicht op rood staat.

Maar wat leert de praktijk van alledag bij een voetgangerslicht?

Dat je als voetganger op het trottoir op een knop kunt drukken en dan wordt enkele seconden later het voetgangerslicht groen.

### § 4.10 Het patroon met negen gestructureerde gegevens rond rechtsbetrekking

Het patroon rond rechtsbetrekking hebben we eveneens nodig om adequaat antwoord te kunnen geven op de twee vragen van de burger:

wat mag ik hier doen?

- waar moet me hier aan houden?

Een persoon opgeleid in de Master Classes Wetsmodelleren I en II en die met succes de daarbij behorende examens heeft afgelegd gaat gemiddeld binnen enkele minuten tot de voorlopige conclusie komen dat we bij de brontekst van RVV, art 74, lid 1 zoals hieronder weergegeven, te doen hebben met 4 verschillende rechtsbetrekkingen. Binnen een half uur is de volledige wetsanalyse uitgevoerd en is duidelijk dat onder a en onder b juridisch exact hetzelfde betekenen.

**Artikel 74**

1. Bij voetgangerslichten betekent:

   - a. groen licht: voetgangers mogen oversteken;

   - b. groen knipperend licht: voetgangers mogen oversteken; het rode licht verschijnt spoedig;

   - c. rood licht: voetgangers mogen niet meer beginnen over te steken; reeds overstekende voetgangers moeten zo snel mogelijk doorlopen.

We zullen ons nader onderzoek uitvoeren aan de hand van het patroon voor rechtsbetrekking. We zullen dat eerst toelichten aan de hand van het concrete geval van het voetgangerslicht, te weten artikel 74, lid 1, onder c, 1e zin:

**Artikel 74**

1. Bij voetgangerslichten betekent:

   - ~~a. groen licht: voetgangers mogen oversteken;~~

   - ~~b. groen knipperend licht: voetgangers mogen oversteken; het rode licht verschijnt spoedig;~~

c. rood licht: voetgangers mogen niet meer beginnen over te steken; ~~reeds overstekende voetgangers moeten zo snel mogelijk doorlopen.~~

We zien in bovenstaande niet-doorgestreepte tekst dat we te doen hebben met een rechtsbetrekking.

### § 4.11 Invulformulier voor rechtsbetrekking

We beginnen met het invullen van het concrete formulier met de 7 gestructureerde gegevens van de rechtsbetrekking in bovenstaande tekst, zeg onder 1, 1e zin. We zien in het ingevulde formulier hieronder dat we 7 gestructureerde gegevens van een rechtsbetrekking bevolken in het wetsmodel. Het achtste gestructureerde gegeven is de annotatie tussen de rechtsbetrekking in de tekst van het RVV art. 74, lid 1 en in het wetsmodel daarvan, mogelijk aangevuld op basis van de kennis van het juridisch analysemodel 2023. Het eerste gestructureerde gegeven van een rechtsbetrekking is een additionele identificatie voor deze rechtsbetrekking binnen het kennisdomein RVV, art 74, lid 1, in dit geval RB01. Deze korte identificatie is nuttig in het verder snel kunnen werken met deze gestructureerde gegevens van deze rechtsbetrekking.

Het tweede gestructureerde gegeven van een rechtsbetrekking is de hoofdsoort. Zoals we eerder hebben gezien, is de hoofdsoort te kiezen uit de volgende 3:

- Aanspraak – verplichting

- Verlof – geenaanspraak

- Bevoegdheid – gehoudenheid.

De tekst ‘mogen niet meer’ duidt duidelijk op een verplichting. Dus als hoofdsoort van RVV art. 74, lid 1 eerste zin stellen we vast:

Aanspraak – verplichting

We weten dat we bij die hoofdsoort drie ondersoorten hebben waar we uit dienen te kiezen, te weten:

- Krachtige aanspraak – fatale verplichting

- Aanspraak na ingebrekestelling – verplichting na ingebrekestelling

- Zwakke aanspraak – zwakke verplichting.

Helaas is in art 74 of elders in het RVV nergens informatie te vinden waar we de beslissing voor een selectie van de ondersoort op kunnen baseren. Gelukkig is er veel volkswijsheid op dit punt. Jaarlijks worden duizenden mensen betrapt met door rood beginnen te lopen en dat resulteert in een boete van meer dan 60 euro. Dus laten we veiligheidshalve op grond van deze volkswijsheid kiezen voor een fatale verplichting. Meestal wordt deze boete immers opgelegd zonder voorafgaande waarschuwing.

TO-DO Overweeg een 4e ondersoort op te nemen, te weten een fatale of na ingebrekestelling rechtsbetrekking.

> **Figuur 9 Invulformulier rechtsbetrekking** — *afbeelding niet overgenomen uit de PDF.*

### § 4.12 Het patroon rond rechtsbetrekking

Het patroon rond rechtsbetrekking laat de gestructureerde gegevenstypes zien.

> **Figuur 10 Patroon rechtsbetrekking III** — *afbeelding niet overgenomen uit de PDF.*

### § 4.13 De samenhang tussen patroon en ingevuld formulier bij rechtsbetrekking

Het patroon van rechtsbetrekking is op het niveau van een grammatica en niet van een concrete uitdrukking die aan de grammatica voldoet. In het formulier is de grammatica aan de linkerkant; de invulling van de uitdrukking aan de rechterkant van het formulier.

> **Figuur 11 Patroon rechtsbetrekking IV** — *afbeelding niet overgenomen uit de PDF.*

We kunnen de bovengenoemde connecties op grammatica niveau tussen de elementen van het patroon en de linkerkant van het formulier (de regels in het formulier) ook met een gestippelde lijn met aan beide kanten een pijlpunt toelichten, zoals hieronder weergegeven.

TO-DO deze pptx ontbreekt helaas hier nog. Ik moet deze de komende dagen opnieuw maken. Ik denk dat ik de tekst nu naar je opstuur zodat je aan de gang kunt

## § 5. Rechtsfeit (juridische toestandsveranderaar)

Bijvoorbeeld een introductie.

## § 6. Rechtsgevolgen (toestandsverandering)

## § 7. Rechtsobject

Bijvoorbeeld een introductie.

NOOT: index Dit hoofdstuk is toegevoegd met `class="informative"` in `config.js` .

## § 8. Juridisch relevant feit in het objectieve en subjectieve recht

Bijvoorbeeld een introductie.

NOOT: index Dit hoofdstuk is toegevoegd met `class="informative"` in `config.js` .

## § 9. Juridische toestand

Bijvoorbeeld een introductie.

NOOT: index Dit hoofdstuk is toegevoegd met `class="informative"` in `config.js` .

## § 10. Afleidingsregel

Bijvoorbeeld een introductie.

NOOT: index Dit hoofdstuk is toegevoegd met `class="informative"` in `config.js` .

## § 11. Voorwaarde

Bijvoorbeeld een introductie.

NOOT: index

Dit hoofdstuk is toegevoegd met `class="informative"` in `config.js` .

## § 12. Variabele en waarde

Bijvoorbeeld een introductie.

NOOT: index

Dit hoofdstuk is toegevoegd met `class="informative"` in `config.js` .

## § 13. Juridisch scenario met juridische aktes

Bijvoorbeeld een introductie.

NOOT: index

Dit hoofdstuk is toegevoegd met `class="informative"` in `config.js` .

## § 14. Begrippenlijst

Deze lijst van begrippen is in de aanbevolen volgorde van kennisname opgesteld. Daarnaast is het nuttig om een begrippenlijst te hebben in alfabetische volgorde. Deze kan worden gevonden in de index.

Voorafgaande opmerking met betrekking tot de identificatie van een begrip: Een _**begrip**_ wordt aangeduid met één enkele voorkeursterm per kennisdomein en 0, 1 of meer alternatieve termen, oftewel synoniemen.

Een _**recht**_ is een soort wettelijk voordeel.

Een _**plicht**_ is een soort wettelijk nadeel.

Een _**voordeelhouder**_ is het rechtssubject waaraan het wettelijk voordeel van de rechtsbetrekking is toegekend.

Een _**nadeelhouder**_ is het rechtssubject waaraan de wettelijk nadeel van de rechtsbetrekking is toegekend.

Een _**begripsdefinitie**_ is de uitleg of omschrijving van de betekenis van een begrip. Een voorbeeld hiervan is de beschrijving van de modelelementen van wetgeving zoals rechtssubject, rechtsbetrekking, rechtsfeit of rechtsgevolg.

Een _**rechtssubject**_ rechtssubject is een drager van rechten (de voordeelkant-houder in een rechtsbetrekking) en/of plichten (de nadeelkant-houder in een rechtsbetrekking), en/of een uitvoerder van een rechtshandeling, een feitelijke handeling met rechtsgevolg of een overtreding met rechtsgevolg.

Een _**rechtsbetrekking**_ is een een juridische relatie tussen twee rechtssubjecten aangaande een rechtsobject. Waarbij het ene rechtssubject de voordeelhouder is en het andere rechtssubject de nadeelhouder. Een rechtsbetrekking heeft dus altijd een rechtssubject aan de voordeel-kant, een rechtssubject aan de nadeel-kant, het betreffende rechtsobject en de gespecificeerde (mogelijke samengestelde) voorwaarde. Een rechtsbetrekking is altijd gebonden aan een voorwaarde en heeft altijd een rechtsobject. Er zijn drie soorten rechtsbetrekkingen, te weten:

1. Aanspraak – verplichting

2. Verlof (vrijheid) – geenaanspraak

3. Bevoegdheid – gehoudenheid

Een _**aanspraak – verplichting**_ is een soort rechtsbetrekking waarbij het nadeel-houdende rechtssubject een verplichting dient na te komen, terwijl het voordeel-houdende rechtssubject aanspraak heeft op het nakomen van deze verplichting. Het nadeel-houdende rechtssubject is het actieve rechtssubject (ook wel ‘actieveling’ genoemd). Van de soort rechtsbetrekking aanspraak – verplichting bestaan vier ondersoorten:

1. krachtige aanspraak – fatale verplichting

2. krachtige aanspraak of aanspraak na ingebrekestelling – fatale verplichting of verplichting na ingebrekestelling

3. aanspraak na ingebrekestelling – verplichting na ingebrekestelling

4. zwakke aanspraak – zwakke verplichting

Een _**krachtige aanspraak – fatale verplichting**_ is een ondersoort van de soort rechtsbetrekking aanspraak – verplichting. Indien het nadeel-houdende rechtssubject zijn fatale verplichting niet

nakomt, krijgt de aanspraak-houder van wetswege de optionele of verplichte bevoegdheid een boete op te leggen aan het rechtssubject dat de fatale verplichting niet is nagekomen.

Een _**krachtige aanspraak of aanspraak na ingebrekestelling – fatale verplichting of verplichting na ingebrekestelling**_ is een ondersoort van de soort rechtsbetrekking aanspraak – verplichting. Bij een krachtige aanspraak of aanspraak na ingebrekestelling – fatale verplichting of verplichting na ingebrekestelling ligt, voorafgaand aan een rechtsfeit in de context van die rechtsbetrekking, niet vast welke van de twee opties geldig is. Denk aan een agent die meteen een boete kan uitdelen of eerst een waarschuwing geeft. Het nadeel-houdende rechtssubject weet vooraf niet welke keuze de agent gaat maken.

Een _**aanspraak na ingebrekestelling – verplichting na ingebrekestelling**_ is een ondersoort van de soort rechtsbetrekking aanspraak – verplichting. Bij een aanspraak na ingebrekestelling – verplichting na ingebrekestelling geldt het volgende: indien de plicht-houder niet aan zijn verplichting voldoet, dan dient de aanspraak-houder de plichthouder schriftelijk een redelijke termijn te geven om alsnog aan de verplichting te voldoen. Voldoet de plichthouder hier niet aan, dan wordt de aanspraak – plicht verhoogd naar een krachtige aanspraak – fatale verplichting.

Een _**zwakke aanspraak – zwakke verplichting**_ is een ondersoort van de soort rechtsbetrekking aanspraak – verplichting. Bij het niet nakomen van de zwakke verplichting heeft de zwakke aanspraakhouder geen recht een boete op te leggen. Wel is gebleken uit jurisprudentie bijv. van de Wet flexibel werken dat een werkgever die niet voldoet aan artikel 2, lid 4 van de wet flexibele werken (de werkgever overlegt met de werknemer) (een zwakke verplichting) daarmee een juridisch relevant feit in het leven roept waarmee de rechter rekening houdt.

Een _**verlof (vrijheid) – geenaanspraak**_ is een soort rechtsbetrekking waarbij de voordeel-houder het verlof (de vrijheid) heeft, om al dan niet gebruik te maken van zijn verlof en de nadeel-houder heeft dat maar te accepteren. Een verlof is een keuze iets te doen of te laten, zoals het al dan niet gebruik maken van een rijbewijs om te mogen rijden in een auto of een paspoort om de grens te mogen passeren. De actieveling is de voordeelhouder, de houder van het verlof. De term geenaanspraak is in het Engels een eeuw geleden ingevoerd door Hohfeld. Van de soort rechtsbetrekking verlof – geenaanspraak bestaat twee ondersoorten:

1. Rechtsfeitbaar verlof

2. Niet rechtsfeitbaar verlof

Een _**rechtsfeitbaar verlof**_ is een ondersoort van de soort rechtsbetrekking verlof (vrijheid) – geenaanspraak. Een rechtsfeitbaar verlof is een verlof waarbij het daadwerkelijk uitoefenen van het verlof een rechtsfeit is en dus rechtsgevolgen heeft. Bijv. indien iemand die vanwege met 70 km/u geflitst word in een max 50 km/u zone, van het CJIB een fatale boete opgelegd krijgt maar tevens een verlof krijgt die boete al vanaf ontvangst van de boetebrief te mogen betalen en hij maakt gebruik van dat verlof, dan heeft die rechtshandeling als gevolg dat daarmee ook logisch wordt

voldaan aan de fatale boete. Men zou kunnen zeggen dat dit een indirect gevolg is van het rechtsfeit van het verlof uitoefenen.

Een _**niet rechtsfeitbaar verlof**_ is een ondersoort van de soort rechtsbetrekking verlof (vrijheid) – geenaanspraak. Een niet rechtsfeitbaar verlof is een verlof indien zowel het gebruik maken van het verlof maar ook het niet gebruik maken van het verlof tot geen rechtsfeit leidt. Bijvoorbeeld bij het al dan niet gebruik maken van het recht je mening te uiten.

Een _**bevoegdheid – gehoudenheid**_ is een soort rechtsbetrekking. Een bevoegdheid geeft de mogelijkheid de bestaande juridische toestand aan te passen door het uitvoeren van de bijbehorende rechtshandeling.

De actieveling is de voordeelhouder, de houder van de bevoegdheid. Van de soort rechtsbetrekking bevoegdheid – gehoudenheid bestaan twee ondersoorten:

1. Gebonden bevoegdheid

2. Optionele bevoegdheid

Een _**gebonden bevoegdheid**_ is een ondersoort van de soort rechtsbetrekking bevoegdheid – gehoudenheid. Bij een gebonden bevoegdheid heeft de bevoegdheidshouder tevens de verplichting de bevoegdheid uit te oefenen. Bijv. het CJIB verkrijgt de gebonden bevoegdheid een boete op te leggen bij geflitst worden met te hard rijden. Waarom is dat zo? Om gelijke behandeling te kunnen garanderen.

Een _**optionele bevoegdheid**_ is een ondersoort van de soort rechtsbetrekking bevoegdheid – gehoudenheid. Bij een optionele bevoegdheid heeft de voordeel-houder de keuze al dan niet zijn bevoegdheid uit te oefenen. Volgens het burgerlijk wetboek geldt dat als iemand niet voldoet aan een fatale verplichting, dan is de aanspraak-houder niet verplicht gebruik te maken van de bevoegdheid hem aansprakelijk te stellen. Dit is een wezenlijk verschil tussen het burgerlijk wetboek en onder meer de wet Mulder.

De _**actieveling**_ , of het actieve rechtssubject, in een rechtsbetrekking is de uitvoerder van het bijbehorend rechtsfeit. Bij een Aanspraak – verplichting is het nadeel-houdende rechtssubject (de verplichting-houder) de actieveling, terwijl bij een Verlof (vrijheid) – geenaanspraak en – Bevoegdheid gehoudenheid het voordeel-houdende rechtssubject (verlofhouder, bevoegdheidhouder) altijd de actieveling is.

Een _**rechtsfeit**_ (juridische toestandsveranderaar) is een handeling door een rechtssubject of een gebeurtenis (niet door een rechtssubject veroorzaakt) die 1 of meer rechtsgevolgen heeft. Een rechtsfeit zet de verandering van een juridische toestand in gang, dus de veranderaar. De verandering zelve wordt een rechtsgevolg genoemd. In het totaal zijn er vijf soorten rechtsfeiten:

1. Rechtshandeling

2. Feitelijke handeling met rechtsgevolg

3. Overtreding met rechtsgevolg

4. Gebeurtenis met rechtsgevolg

5. Tijdsverloop met rechtsgevolg.

Een _**rechtshandeling**_ is een specialisatie van rechtsfeit en heeft rechtsgevolgen en is een handeling van een rechtssubject met een beoogd doel. Bijv. Pia doet Carla het aanbod haar fiets voor 95 euro te kopen, mits het aanbod binnen twee dagen aanvaard is. Pia verricht een rechtshandeling. Het beoogde doel is Carla ertoe te bewegen haar fiets voor 95 euro te kopen. Als Carla binnen twee dagen het aanbod afwijst is er ook sprake van een rechtshandeling door Carla.

Een _**feitelijke handeling met rechtsgevolg**_ is een specialisatie van rechtsfeit, heeft rechtsgevolgen, maar beoogt die rechtsgevolgen niet. Het is een handeling van een rechtssubject met een niet beoogd doel. Bijv. Jan maakt per ongeluk een kras op een auto. Niet beoogd, wel aansprakelijk.

Een _**overtreding met rechtsgevolg**_ is een specialisatie van rechtsfeit waarbij er sprake is van een handeling van een rechtssubject die een overtreding is van een aanspraak – verplichting en waarbij het beoogd doel niet binnen scope, oftewel niet relevant is.

Een _**gebeurtenis met rechtsgevolg**_ is een specialisatie van rechtsfeit waarbij er sprake is van en gebeurtenis die optreedt zonder handelend rechtssubject en waarbij de tijd geen rol speelt. Bijv. een blikseminslag; geboren worden; sterven.

Een _**tijdsverloop met rechtsgevolg**_ is een specialisatie van rechtsfeit waarbij er sprake is van een gebeurtenis die optreedt zonder handelend rechtssubject en die optreedt na een bepaald tijdsverloop. Bijv. meerderjarig worden bij 18 jaar.

Een _**rechtsgevolg**_ is de verandering van een juridische toestand die ontstaat vanwege een rechtsfeit. Een rechtsgevolg is 1 of meer van de volgende 6:

1. het doen ontstaan van een rechtsbetrekking;

2. het aanpassen van een eigenschap van een rechtsbetrekking;

3. het ten einde stellen van een rechtsbetrekking;

4. het doen ontstaan van een juridisch relevant feit;

5. het aanpassen van een eigenschap van een juridisch relevant feit;

6. het ten einde stellen van een juridisch relevant feit.

Een _**voorwaarde**_ is een uitdrukking die aangeeft onder welke condities:

- een specialisatie van een rechtssubject geldig is;

- een rechtsbetrekking geldig is;

- een rechtsfeit geldig is;

een afleidingsregel mag worden uitgevoerd. Een voorwaarde maakt gebruik van 1 of meer juridisch relevante feiten.

Een _**rechtsobject**_ is het voorwerp van een rechtsbetrekking of van een rechtsfeit. Een rechtsobject bestaat uit 1 of meer juridisch relevante feiten.

Een _**afleidingsregel**_ is een voorschrift dat een of meer juridisch relevante feiten (gegevens) als invoer heeft en meestal 1 maar soms meer juridisch relevante feiten (gegevens) als uitvoer. Tijdens de uitvoering van de afleidingsregel worden de gegevens in de invoer verwerkt tot gegevens in de uitvoer.

Een _**feit**_ is een bewering waarvan wordt aangenomen dat ze waar is. Voorbeelden van feiten zijn: Amsterdam is momenteel de hoofdstad van Nederland. Berlijn is momenteel de hoofdstad van Duitsland. Nederland grenst in het oosten aan Duitsland en in het zuiden aan België.

Een _**variabele**_ is een plek om een waarde vast te leggen, waarbij deze waarde kan variëren. Het is essentieel te beseffen dat een variabele bijna altijd onderdeel uitmaakt van een feittype met meer dan één variabele. Bij variabelen is het tevens essentieel onderscheid te maken tussen onafhankelijke (die onder een sleutel vallen, de bepalende variabelen) en de afhankelijke variabelen (die niet onder een sleutel vallen en waarvan de waarde bepaald wordt door de waarden van de bepalende variabelen). Stel men meet het gewicht van een patiënt op verschillende tijdstippen in een ziekenhuis. Voorbeeld: patiënt 123 weegt op 2023-08-27-10:05 65.4 kilogram. Dit is een gegeven of feit met drie variabelen. De waarde van de variabele patiënt bepaalt tezamen met de waarde van tijdstip het gewicht.

Een _**waarde**_ is een concreet gegeven (€1650, 12,4 %), bijv. de hoogte van het minimumloon in een bepaalde tijdsperiode.

Een _**juridisch relevant feit**_ is gedefinieerd als een feit dat in een voorwaarde op een rechtssubject, rechtsbetrekking of rechtsfeit voorkomt, of in een specificatie van een rechtsobject, of als invoergegeven of uitvoergegeven van een afleidingsregel.

Een _**niet juridisch relevante tekst**_ is een stuk tekst dat qua betekenis niet relevant is voor het model van de wetgeving, de wetsuitvoering of juridisch scenario. Bij regelgeving is soms sprake van kleine hoeveelheden tekst die juridisch niet relevant zijn. Het is vaak de taalsuiker.

Het _**objectief recht**_ is het recht zoals beschreven in wetgeving en daarmee samenhangende hogere en lagere regelgeving.

Het _**subjectief recht**_ betreft het uitvoeren van objectief recht in een concreet geval met twee en soms meer rechtssubjecten of het overeenkomen van een overeenkomst en die naleven of niet naleven.

Vaak helpt de volgende toelichting op objectief en subjectief recht. Objectief recht is het recht zoals beschreven in wet- en regelgeving. In objectief recht hebben we te doen met rechtssubjecttypen,

rechtsbetrekkingtypen, rechtsfeittypen of rechtsgevolgtypen. Voorbeelden zijn natuurlijke persoon, voetganger, rechtspersoon.

In het subjectieve recht hebben we bij voorbeeld te doen met Andre Rieu, Max Verstappen of ASML. De eerstgenoemde is een instantie van een natuurlijk persoon, en een specialisatie van natuurlijke persoon voor de IB, genaamd binnenlandse belastingplichtige. ASML is een instantie van een rechtspersoon.

Een _**juridisch scenario**_ bestaat uit een opeenvolging juridische aktes en beschrijft de volledig geëxpliciteerde juridische ervaring van de burger of het bedrijf of rechtspersoon.

Een _**juridische akte**_ bestaat uit de volgende 4 onderdelen:

1. Juridische begintoestand, (een verzameling rechtsbetrekkingen en/of juridisch relevante feiten)

2. Rechtsfeit (toestandsverander **aar** ),

3. Rechtsgevolg (toestandsverander **ing** ),

4. Juridische eindtoestand (een verzameling rechtsbetrekkingen en/of juridisch relevante feiten).

Een _**juridische toestand**_ bestaat uit een verzameling van rechtsbetrekkingen en/of juridisch relevante feiten. Let op: het bestaan van een rechtsbetrekking impliceert het bestaan van het voordeel-houdende en nadeel-houdende rechtssubject.

Een _**juridisch kennisdomein**_ , ook wel aangeduid als kennisgebied is een afbakening uitgedrukt in de vulling van het juridisch referentiemodel (JRM 2.0) of afgebakend als teksten in de traditioneel beschreven wetgeving.

Een _**kennisdomein**_ is een willekeurig afgebakende hoeveelheid kennis. Bijv. men kan RVV art 74, lid 1 als kennisdomein zien met de naam Voetgangerslicht. Men kan de Inkomstenbelasting als kennisdomein zien, maar men kan een heel klein deel van de Inkomstenbelasting bijv. IB 2.1 als kennisdomein zien met de naam binnenlandse en buitenlandse belastingplichtigen voor de Inkomstenbelasting. Een binnenlandse belastingplichtige voor de Inkomstenbelasting is een natuurlijke persoon die in Nederland woont. Een buitenlandse belastingplichtige voor de Inkomstenbelasting is een natuurlijke persoon die niet in Nederland woont, maar wel Nederlands inkomen geniet. In een begripsomschrijving komen bijna altijd termen voor die in een of meer andere begripsomschrijvingen worden gedefinieerd. Vanuit een bepaalde begripsomschrijving wordt verwezen naar termen die in een andere begripsomschrijving zijn gedefinieerd. Deze twee gegevens kunnen door een intelligent systeem automatisch worden aangemaakt.

Binnen de context van het referentiemodel is een _**gegeven**_ is een vastgelegde bewering die voor waar wordt aangenomen. Voorbeelden van gegevens. Amsterdam is de huidige hoofdstad van Nederland. Berlijn is de huidige hoofdstad van Duitsland. In beide beweringen treffen we twee

ingevulde of geïnstantieerde variabelen aan, te weten het koppel Amsterdam en Nederland en het koppel Berlijn en Duitsland. Verder hebben beide beweringen een gemeenschappelijk werkwoorddeel: is de huidige hoofdstad van.

De afstand van Maastricht naar Amsterdam is 212 km. De afstand van Nijmegen naar Groningen is 194 km. In beide beweringen treffen we drie ingevulde variabelen aan, te weten het triple Maastricht, Groningen en 212 en het triple Nijmegen, Groningen en 194. Verder hebben beide beweringen een gemeenschappelijk werkwoorddeel: De afstand van … naar … is … km. De drie puntjes duiden op de drie plaatsen waar een waarde van de betreffende variabele staat.

Een _**gegevenskwaliteitsregel**_ (voorheen meestal aangeduid als een beperkingsregel in gegevensmodellering) is een formulering die aangeeft welke toestanden een gegevensverzameling mag aannemen en welke toestandsovergangen toegestaan zijn. Bij de gegevens van afstand hierboven geldt dat bij elk paar steden er precies één afstand kan voorkomen in de gegevensverzameling.

Stel men zou een ondergrondse autoweg aanleggen tussen Maastricht en Amsterdam, dan is het wenselijk het gegeven als volgt uit te breiden met de volgende twee gegevens: Met ingang van 1.1.2099 is de afstand van Maastricht naar Amsterdam 199 km. Met ingang van 31.12.2098 is de afstand van Maastricht naar Amsterdam niet langer 212 km. Deze uitbreiding wordt vaak aangeduid als tijdreizen.

Een _**overeenkomst**_ tussen 2 of meer rechtssubjecten bestaat uit:

- een verzameling begripsomschrijvingen;

- een verzameling rechtsbetrekkingen en/of juridisch relevante feiten en/of;

- een verzameling rechtsfeiten en/of;

- een verzameling rechtsgevolgen;

- een verzameling afleidingsregels.

Waarbij geldt dat minstens een van de vier verzamelingen van rechtsbetrekking, juridisch relevante feiten, rechtsfeiten en rechtsgevolgen niet leeg mag zijn.

_**RegelSpraak**_ RegelSpraak is een gecontroleerde Nederlandse taal die is ontwikkeld bij de Belastingdienst. Deze taal wordt gebruikt om belastingregels mee te beschrijven. De RegelSpraakregels zijn preciezer dan in de onderliggende wetsartikelen verwoord. Deze precisie van de regels zorgt ervoor dat deze geautomatiseerd ‘vertaald’ kunnen worden naar softwarecode om de bedoelde beoordeling – op basis van gegevens uit de aangifte van het voorgaande jaar – uit te voeren _Voorbeeld van een Regelspraak-regel_ .

## § 15. Conformiteit

Naast onderdelen die als niet normatief gemarkeerd zijn, zijn ook alle diagrammen, voorbeelden, en noten in dit document niet normatief. Verder is alles in dit document normatief.

## § 16. Lijst met figuren

> De figuren stonden in de PDF als afbeelding en zijn hier niet overgenomen.

1. Figuur 1 — voorbeelden van rechtssubjecten
2. Figuur 2 — Invulformulier rechtssubject I
3. Figuur 3 — Invulformulier rechtssubject II
4. Figuur 4 — Patroon rechtssubject I
5. Figuur 5 — Patroon rechtssubject II
6. Figuur 6 — Rechtsbetrekkingen
7. Figuur 7 — Patroon rechtsbetrekking I
8. Figuur 8 — Patroon rechtsbetrekking II
9. Figuur 9 — Invulformulier rechtsbetrekking
10. Figuur 10 — Patroon rechtsbetrekking III
11. Figuur 11 — Patroon rechtsbetrekking IV

## § A. Index

### § A.1 Begrippen gedefinieerd door deze specificatie

Alle onderstaande begrippen zijn gedefinieerd in [§ 14. Begrippenlijst](#-14-begrippenlijst).

- aanspraak – verplichting
- aanspraak na ingebrekestelling – verplichting na ingebrekestelling
- actieveling
- afleidingsregel
- begrip
- begripsdefinitie
- bevoegdheid – gehoudenheid
- feit
- feitelijke handeling met rechtsgevolg
- gebeurtenis met rechtsgevolg
- gebonden bevoegdheid
- gegeven
- gegevenskwaliteitsregel
- juridisch kennisdomein
- juridisch relevant feit
- juridisch scenario
- juridische akte
- juridische toestand
- kennisdomein
- krachtige aanspraak – fatale verplichting
- krachtige aanspraak of aanspraak na ingebrekestelling – fatale verplichting of verplichting na ingebrekestelling
- nadeelhouder
- niet juridisch relevante tekst
- niet rechtsfeitbaar verlof
- objectief recht
- optionele bevoegdheid
- overeenkomst
- overtreding met rechtsgevolg
- plicht
- recht
- rechtsbetrekking
- rechtsfeit
- rechtsfeitbaar verlof
- rechtsgevolg
- rechtshandeling
- rechtsobject
- rechtssubject
- RegelSpraak
- subjectief recht
- tijdsverloop met rechtsgevolg
- variabele
- verlof (vrijheid) – geenaanspraak
- voordeelhouder
- voorwaarde
- waarde
- zwakke aanspraak – zwakke verplichting

### § A.2 Begrippen gedefinieerd door verwijzing

*(In de bron leeg gelaten.)*
