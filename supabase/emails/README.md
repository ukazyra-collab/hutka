# Письма Hutka (Supabase Auth → Emails → Templates)

Свой отправитель: Project Settings → Authentication → SMTP Settings → Enable Custom SMTP (Resend: host `smtp.resend.com`, port `465`, user `resend`, password = API key, sender `no-reply@hutka.ai`, name `Hutka`). Домен `hutka.ai` сначала подтверждается в Resend (3 DNS-записи в GoDaddy).

Шаблоны — вставить целиком в поле Body, тему — в Subject:

| Шаблон в Supabase | Файл | Subject |
|---|---|---|
| Magic Link | `magic-link.html` | `Your sign-in link to Hutka · Вход в Hutka` |
| Confirm signup | `confirm-signup.html` | `Confirm your email for Hutka · Подтверди почту` |
| Change Email Address | `email-change.html` | `Confirm your new email for Hutka` |
| Reset Password | `recovery.html` | `Reset your Hutka password` |

Переменные `{{ .ConfirmationURL }}` и `{{ .Email }}` подставляет Supabase. Лимит писем: Authentication → Rate Limits → emails sent — 100 в час (с своим SMTP).
