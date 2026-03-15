-- Claw machine batch data — stored server-side so Vercel API routes can
-- generate Merkle proofs without a persistent filesystem.

create table if not exists claw_batches (
  batch_id     text        primary key,
  merkle_root  text        not null,
  batch_size   int         not null,
  outcomes     jsonb       not null,   -- number[] — playIndex → rewardClass (1-5)
  tree_dump    jsonb       not null,   -- StandardMerkleTree.dump() output
  inventory    jsonb       not null,   -- { lose, common, rare, epic, legendary }
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);

-- Index so we can quickly fetch the active batch
create index if not exists claw_batches_active_idx on claw_batches (active);
