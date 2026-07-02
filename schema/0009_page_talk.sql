-- Discussions generalize beyond nodes: the homepage (and future site pages)
-- get talk threads under reserved subjects like 'home'. The FK to nodes goes;
-- subject validity is enforced at the route (a real node id or a reserved
-- page key), which nodes never being hard-deleted makes safe.

alter table comments drop constraint comments_node_id_fkey;
