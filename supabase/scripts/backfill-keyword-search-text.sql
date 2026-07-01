-- Одноразовий backfill для фічі «Ключові слова»: заповнює bot_cases.search_text /
-- bot_verif_cases.search_text для СПРАВ, ЗАКРИТИХ ДО деплою фічі (нові справи вже
-- отримують search_text автоматично при закритті, з коду).
--
-- Без цього ретроскан (bot_keyword_backfill_scan) при доданні нового блоку слів
-- не знайде історичні збіги — колонка буде порожньою.
--
-- search_text = normalize(lower(join(' ', answer))) по полях з роллю 'title'/'notes'
-- (номери/роки/кількість сторінок — не пошуковий текст).
--
-- Ідемпотентно: чіпає лише рядки, де search_text ще порожній.
-- Як запустити: Supabase → SQL Editor → New query → вставити → Run.

-- ---------- bot_cases (collab-режим): questions — глобальний конфіг bot_meta ----------
with q as (
  select coalesce(value::jsonb, '[]'::jsonb) as questions
  from bot_meta where key = 'questions'
)
update bot_cases c
   set search_text = lower(coalesce((
         select string_agg(coalesce(c.current_answers ->> (e.ordinality - 1)::int, ''), ' ')
         from q, jsonb_array_elements(q.questions) with ordinality as e(val, ordinality)
         where e.val ->> 'role' in ('title', 'notes')
       ), ''))
 where c.status = 'done'
   and c.mode = 'collaborative'
   and c.search_text = '';

-- ---------- bot_verif_cases: questions — власний снапшот на рядку (з фолбеком на bot_meta) ----------
with q as (
  select coalesce(value::jsonb, '[]'::jsonb) as admin_questions
  from bot_meta where key = 'questions'
)
update bot_verif_cases c
   set search_text = lower(coalesce((
         select string_agg(coalesce(c.current_answers ->> (e.ordinality - 1)::int, ''), ' ')
         from jsonb_array_elements(
                case when jsonb_array_length(coalesce(c.questions, '[]'::jsonb)) > 0
                     then c.questions
                     else (select admin_questions from q)
                end
              ) with ordinality as e(val, ordinality)
         where e.val ->> 'role' in ('title', 'notes')
       ), ''))
 where c.status = 'done'
   and c.search_text = '';
