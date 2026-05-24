-- ============================================================================
-- Частоти слів із розпізнаних заголовків — для генерації «фраз дня» Описового пазла.
-- Запусти в Supabase → SQL Editor. Поверне: word (слово) + cnt (у скількох
-- заголовках воно трапилось). Скопіюй слова в промт для моделі (див. нижче).
--
-- Джерело — РОЗПІЗНАНІ КОЛАБОРАТИВНІ справи (саме звідки гра збирає слова),
-- тож слова з результату напевно «збиральні».
--
-- Нормалізація наближена до тієї, що в грі (api/telegram/puzzleWords.ts):
--   • нижній регістр; • апострофи ’‘`´ → '; • обрізана облямівкова пунктуація;
--   • внутрішні апостроф/дефіс лишаються; • без чисел і стоп-слів.
--
-- ПРЕФІКС: прод — bot_  (нижче). Для staging заміни bot_ на botdev_.
-- НАЛАШТУВАННЯ: char_length >= 3 (мін. довжина), limit 500 (скільки слів узяти).
-- Щоб додати й паралельні розпізнавання — розкоментуй блок union all.
-- ============================================================================

with title_idx as (
  -- Індекс поля із роллю title серед питань (зберігаються як JSON у bot_meta).
  select (ord - 1)::int as idx
  from bot_meta m,
       lateral jsonb_array_elements((m.value)::jsonb) with ordinality as e(elem, ord)
  where m.key = 'questions'
    and elem->>'role' = 'title'
  limit 1
),
raw_titles as (
  select row_number() over () as rid,
         c.current_answers ->> (select idx from title_idx) as title
  from bot_cases c
  where c.mode = 'collaborative'
    and c.confirmations_count > 0

  -- (опційно) додати паралельні розпізнавання — більше слів, але деякі можуть
  -- бути з описів, які гра не збирає (parallel). Розкоментуй за потреби:
  -- union all
  -- select 1000000 + row_number() over () as rid,
  --        s.answers ->> (select idx from title_idx) as title
  -- from bot_submissions s
),
tokens as (
  select t.rid,
         nullif(
           regexp_replace(
             -- 1) нижній регістр + апострофи до одного вигляду
             regexp_replace(lower(coalesce(w, '')), '[’‘`´]', '''', 'g'),
             -- 2) обрізати з країв усе, крім літер/цифр/апострофа/дефіса
             '^[^a-zа-яіїєґ0-9''-]+|[^a-zа-яіїєґ0-9''-]+$', '', 'g'
           ),
         '') as word
  from raw_titles t,
       lateral regexp_split_to_table(coalesce(t.title, ''), '\s+') as w
)
select word, count(distinct rid) as cnt
from tokens
where word is not null
  and char_length(word) >= 3            -- відкинути дуже короткі
  and word !~ '^[0-9]+$'                -- відкинути суто числа (роки/номери)
  and word not in (                     -- стоп-слова (мають збігатися з config.puzzle.stopwords)
    -- російські
    'и','а','но','да','или','либо','что','как','это','то','же','бы','ли','не','ни',
    'в','во','на','за','по','до','от','из','к','ко','с','со','о','об','обо','у',
    'для','про','при','без','над','под','перед','между','через','около',
    -- українські
    'і','й','та','із','зі','від','що','як','це','бо','чи','ж','б','би','те','так','але'
  )
group by word
order by cnt desc, word
limit 500;
