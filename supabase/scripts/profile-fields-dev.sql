-- Профільні поля користувача (STAGING, префікс botdev_).
-- Дзеркальний прод-скрипт: profile-fields.sql (префікс bot_).
-- Семантика полів — див. коментар у profile-fields.sql.
--
-- Безпечно прогнати кілька разів (IF NOT EXISTS).

alter table botdev_users add column if not exists city text;
alter table botdev_users add column if not exists region text;
alter table botdev_users add column if not exists tg_username text;
alter table botdev_users add column if not exists phone_number text;
alter table botdev_users add column if not exists facebook_url text;
alter table botdev_users add column if not exists photo_file_id text;
alter table botdev_users add column if not exists photo_message_id text;

create index if not exists botdev_users_tg_username_idx on botdev_users (lower(tg_username));
create index if not exists botdev_users_phone_idx on botdev_users (phone_number);
