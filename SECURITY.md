# Security Policy

## Never commit

- Supabase `service_role`
- private OAuth tokens
- Mercado Pago Access Tokens
- webhook signing secrets
- user passwords
- database passwords

The Supabase browser anon key is public by design. It must still be tied to the expected project and all sensitive access must be protected by RLS/RPC rules.

## Security boundaries

The frontend is never considered an authorization boundary.

Critical operations must be validated by PostgreSQL / Supabase backend logic.

## Reporting

Security issues should be handled privately before creating a public issue if the repository becomes public.
