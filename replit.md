# RODIA Store

## Run locally or in the Replit preview

```bash
npm install
npm start
```

The server listens on `process.env.PORT` (default `5000`) and binds to
`0.0.0.0`. The admin dashboard is available at `/admin`.

## Configuration

Sensitive values are stored in Replit Secrets. The configured names are:

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_ID`
- `VERIFY_TOKEN`
- `ADMIN_PHONE`
- `ADMIN_PASSWORD`
- `GROQ_API_KEY`
- `NVIDIA_API_KEY`
- `BANK_NAME`
- `ACCOUNT_NUMBER`
- `ACCOUNT_NAME`

Shared non-secret values are `PORT=5000`, `DB_PATH=rodia.db`,
`GROQ_MODEL=llama-3.3-70b-versatile`, `NVIDIA_MODEL=meta/llama-3.3-70b-instruct`,
`MIN_ORDER=0`, and `DEFAULT_DELIVERY_FEE=1000`.

AI requests intentionally try Groq first, NVIDIA second, and then fall back to
the bot's keyword rules if both providers fail.

## WhatsApp webhook

After publishing, use the production URL returned by Replit and append
`/webhook`. The Meta callback URL is therefore:

```text
https://<published-replit-domain>/webhook
```

The Meta verify token must match the `VERIFY_TOKEN` secret.

## Deployment and database note

Deployment is configured as an always-running VM with `npm start`, which is
appropriate for the WhatsApp webhook bot. The SQLite file is suitable for local
development and the current workspace, but Replit deployment filesystems are
not persistent across VM restarts or redeployments. Before relying on deployed
orders, migrate the SQLite data layer to a persistent relational database such
as Replit's PostgreSQL database. Do not publish production data with the
expectation that `rodia.db` will survive a deployment.