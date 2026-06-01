# Metadata Remover

Webapp para visualizar e remover metadados de **imagens** e **vídeos**.

## Fluxo

1. Entre com a senha configurada no servidor.
2. Envie uma foto ou vídeo (arrastar ou selecionar).
3. O sistema lista os metadados encontrados.
4. **Imagem:** botão **Gerar imagem sem metadados** (reencodifica com Sharp).
5. **Vídeo:** escolha **Limpar (rápido)** — remux FFmpeg sem perda de qualidade — ou **Limpar (máximo)** — reencoda H.264/AAC para limpeza mais profunda.
6. Opcional: abra o [Ghost Chat](https://ghosth.chat) para enviar o arquivo na sala.

## Formatos e limites

| Tipo | Formatos | Limite padrão |
|------|----------|---------------|
| Imagem | JPEG, PNG, WebP, GIF, TIFF, AVIF, HEIC | 25 MB (`MAX_IMAGE_MB`) |
| Vídeo | MP4, MOV, MKV, WebM, AVI | 200 MB (`MAX_VIDEO_MB`) |

## Autenticação

Defina no ambiente (Bunny, Docker ou `.env` local):

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `APP_PASSWORD` | Sim | Senha de acesso ao site |
| `SESSION_SECRET` | Recomendado | Assinatura do cookie de sessão (se omitido, usa `APP_PASSWORD`) |

A API (`/api/analyze`, `/api/strip`) exige cookie de sessão + header `X-CSRF-Token` retornado no login. Rotas públicas: `/health`, `/api/login`, `/api/session`.

## Desenvolvimento local

```bash
cp .env.example .env
# edite APP_PASSWORD e SESSION_SECRET
export $(grep -v '^#' .env | xargs)
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Docker

```bash
docker build -t metadata-remover .
docker run -p 3000:3000 \
  -e APP_PASSWORD=sua-senha \
  -e SESSION_SECRET=segredo-longo \
  metadata-remover
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
4. Variáveis de ambiente: `APP_PASSWORD`, `SESSION_SECRET`.
5. Health check: `GET /health` na mesma porta.

### Build manual

```bash
docker build -t ghcr.io/SEU_USUARIO/metadata-remover:latest .
docker push ghcr.io/SEU_USUARIO/metadata-remover:latest
```

## API

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| `POST` | `/api/login` | — | `{ "password": "..." }` — define cookie + retorna `csrfToken` |
| `GET` | `/api/session` | cookie | Estado da sessão |
| `POST` | `/api/logout` | cookie + CSRF | Encerra sessão |
| `POST` | `/api/analyze` | cookie + CSRF | Campo `file` (multipart) — metadados em JSON |
| `POST` | `/api/strip` | cookie + CSRF | Campo `file` + `mode` (`fast` ou `max`, só vídeo) |
| `GET` | `/health` | — | Health check |

Vídeos usam **FFmpeg** e **ExifTool** no container Docker.
