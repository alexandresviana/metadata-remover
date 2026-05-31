# Metadata Remover

Webapp para visualizar e remover metadados (EXIF, GPS, XMP, IPTC, ICC) de imagens.

## Fluxo

1. Envie uma foto (arrastar ou selecionar).
2. O sistema lista os metadados encontrados.
3. Clique em **Gerar imagem sem metadados** para baixar a versão limpa.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Docker

```bash
docker build -t metadata-remover .
docker run -p 3000:3000 metadata-remover
```

## Deploy na Bunny (Magic Containers)

### Imagem Docker (CI automático)

A cada push na branch `main`, o GitHub Actions publica a imagem em:

```text
ghcr.io/alexandresviana/metadata-remover:latest
```

(Substitua o usuário/org se o repositório estiver em outra conta.)

Na Bunny:

1. **Magic Containers** → criar app → imagem: `ghcr.io/<seu-usuario>/metadata-remover:latest`
2. Se o pacote GHCR for privado, adicione credenciais de registry (PAT com `read:packages`).
3. Porta do container: **3000** (ou variável `PORT`).
4. Health check: `GET /health` na mesma porta.

### Build manual

```bash
docker build -t ghcr.io/SEU_USUARIO/metadata-remover:latest .
docker push ghcr.io/SEU_USUARIO/metadata-remover:latest
```

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/analyze` | Campo `image` (multipart) — retorna metadados em JSON |
| `POST` | `/api/strip` | Campo `image` (multipart) — retorna arquivo sem metadados |
| `GET` | `/health` | Health check |

Limite de upload: **25 MB**.
