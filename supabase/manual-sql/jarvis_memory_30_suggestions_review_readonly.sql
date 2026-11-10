-- READ ONLY. The suggestions staff sent from JARVIS ("Suggest a correction"), oldest first, for the reviewer.
-- A suggestion changes nothing by itself. To act on one: edit the topic in docs/enginious-os/staff-guidance/, run `npm run build:jarvis-knowledge`, open a pull request,
-- review, merge and deploy (docs/enginious-os/staff-guidance/README.md). Then record the decision (this statement CHANGES the database; run it deliberately):
--   update jarvis_knowledge_suggestions set status = 'accepted', reviewed_at = now(), review_note = '<PR number>' where id = '<id>';   -- or 'declined'
select s.id, s.created_at, s.topic_id, s.body, s.status, p.full_name as suggested_by
from jarvis_knowledge_suggestions s left join profiles p on p.id = s.user_id
where s.status = 'pending'
order by s.created_at;
