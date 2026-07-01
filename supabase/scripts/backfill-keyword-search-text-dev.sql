-- Дзеркало backfill-keyword-search-text.sql для STAGING (префікс botdev_).
-- Семантика — див. коментар у backfill-keyword-search-text.sql.

with q as (
  select coalesce(value::jsonb, '[]'::jsonb) as questions
  from botdev_meta where key = 'questions'
)
update botdev_cases c
   set search_text = lower(coalesce((
         select string_agg(coalesce(c.current_answers ->> (e.ordinality - 1)::int, ''), ' ')
         from q, jsonb_array_elements(q.questions) with ordinality as e(val, ordinality)
         where e.val ->> 'role' in ('title', 'notes')
       ), ''))
 where c.status = 'done'
   and c.mode = 'collaborative'
   and c.search_text = '';

with q as (
  select coalesce(value::jsonb, '[]'::jsonb) as admin_questions
  from botdev_meta where key = 'questions'
)
update botdev_verif_cases c
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
