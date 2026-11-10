-- WRITES. OWNER-RUN ROLLBACK of 20261226000100_jarvis_memory_suggestions.sql only (JARVIS itself stays). Safe to run twice.
-- It deletes every saved preference and every suggestion: export jarvis_knowledge_suggestions first if the suggestions matter.
-- After it, JARVIS still works: saving a preference or a suggestion says it is not set up, and no preference is applied.
drop function if exists jarvis_suggest_correction(text, text);
drop function if exists jarvis_pref_delete(text);
drop function if exists jarvis_pref_set(text, text);
drop function if exists jarvis_pref_list();
drop table if exists jarvis_knowledge_suggestions;
drop table if exists jarvis_preferences;
