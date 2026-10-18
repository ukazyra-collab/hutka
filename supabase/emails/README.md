# Письма Hutka (Supabase Auth → Emails → Templates)

Свой отправитель: Project Settings → Authentication → SMTP Settings → Enable Custom SMTP (Resend: host `smtp.resend.com`, port `465`, user `resend`, password = API key, sender `no-reply@hutka.ai`, name `Hutka`). Домен `hutka.ai` сначала подтверждается в Resend (3 DNS-записи в GoDaddy).

Шаблоны — вставить целиком в поле Body, тему — в Subject:

| Шаблон в Supabase | Файл | Subject |
|---|---|---|
| Magic Link | `magic-link.html` | `Your Hutka code · Код для входа в Hutka` |
| Confirm signup | `confirm-signup.html` | `Confirm your email for Hutka · Подтверди почту` |
| Change Email Address | `email-change.html` | `Confirm your new email for Hutka` |
| Reset Password | `recovery.html` | `Reset your Hutka password` |

Переменные `{{ .ConfirmationURL }}`, `{{ .Email }}` и `{{ .Token }}` (шестизначный код входа — тот же токен, что в ссылке; с v33.2 письмо Magic Link показывает его для приложения) подставляет Supabase. После правки `magic-link.html` шаблон нужно вставить в Supabase заново (Authentication → Email Templates → Magic Link → Body). Лимит писем: Authentication → Rate Limits → emails sent — 100 в час (с своим SMTP).
