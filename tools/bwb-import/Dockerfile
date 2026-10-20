# Self-contained image voor de BWB-importservice (FastAPI).
FROM python:3.15-slim

WORKDIR /app

# Pip eerst upgraden en zijn vendored SBOM weghalen — zelfde fix als in api/Dockerfile en
# tools/graph-qa/Dockerfile, dit was de derde plek die hem nodig had. pip 26.x bakt een
# CycloneDX-SBOM van zijn eigen vendored deps mee (`pip/_vendor/bom.cdx.json`) die Trivy als
# pakketinventaris leest: die meldde hier setuptools 70.3.0 (CVE-2025-47273, CVE-2026-59890) en
# msgpack 1.1.2 (GHSA-6v7p-g79w-8964) terwijl geen van beide als pakket geïnstalleerd is.
RUN pip install --no-cache-dir --upgrade pip 'setuptools>=83.0.0' \
 && rm -f /usr/local/lib/python3.14/site-packages/pip/_vendor/bom.cdx.json

# Dependencies (betere layer-caching). lxml-wheels bundelen libxml2/libxslt.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Applicatiecode en de officiële XSD's.
COPY app ./app
COPY schemas ./schemas

EXPOSE 8000

CMD ["uvicorn", "app.service:app", "--host", "0.0.0.0", "--port", "8000"]
