-- ROLLBACK for 20270112000200_ops_question_notice.sql. It removes the trigger and its two functions: Operations' questions are saved exactly as before and Sales is no longer
-- told. The notices already sent are KEPT (they are people's own records); with the app from before this change they read "A project update." in Project notices.
-- To remove them as well, run the commented line. It deletes no enquiry, question or answer. Safe to run twice. Either app version works with or without this migration.
drop trigger if exists trg_ops_question_notify on ops_enquiry_planning;
drop function if exists ops_question_notify();
drop function if exists ops_question_recipients(uuid);
-- delete from notifications where type = 'project_ops_question';
