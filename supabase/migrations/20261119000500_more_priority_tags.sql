-- Two gentler priority choices for submitters, below 'important'.
-- Enum order is ascending urgency, so `order by admin_tag desc` still sorts by priority:
--   just_sayin < casual < important < urgent < crucial
alter type public.priority_tag add value if not exists 'casual' before 'important';
alter type public.priority_tag add value if not exists 'just_sayin' before 'casual';
