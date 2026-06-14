-- =============================================================================
-- Parvalon — Allium SQL reference (production indexer alternative to The Graph)
-- =============================================================================
--
-- Allium is named as the production indexer alternative. These queries
-- reconstruct the SAME action + claim dataset the subgraph exposes, straight
-- from Allium's decoded-logs tables, so a data team can run Parvalon analytics
-- in the warehouse without operating a Graph Node.
--
-- ASSUMPTIONS / WIRING (adjust to your Allium workspace):
--   * Allium exposes decoded events in a `<chain>.decoded.logs` table (a.k.a.
--     `decoded_events`) with columns:
--         block_number, block_timestamp, transaction_hash, log_index,
--         address (emitting contract), name (event name), params (JSON/VARIANT)
--     Column/table names vary by Allium plan & chain. The CTEs below isolate
--     every such dependency so you only edit the FROM/WHERE in one place.
--   * Robinhood Chain (chainId 46630) is an Arbitrum Orbit L2. If Allium has
--     not onboarded it, point these queries at an `arbitrum_sepolia` (421614)
--     dataset for the fallback deployment, or at a custom-decoded source.
--   * :registry and :distributor are bind parameters = the deployed addresses
--     from deployments/<chainId>.json (lower-cased hex).
--   * Amounts are kept as on-chain integers (wei). Decimal scaling is a
--     presentation concern (mirrors the subgraph + INTEGRATION.md §10 note that
--     wei stays wei until the public feed formats it).
--   * enum decoding mirrors INTEGRATION.md §2:
--         ActionType   0=CASH_DIVIDEND 1=STOCK_SPLIT 2=STOCK_DIVIDEND
--         ActionStatus 0=ANNOUNCED 1=ROOT_PUBLISHED 2=CLAIMABLE 3=FINALIZED 4=CANCELLED
--
-- JSON access syntax shown as `params:fieldName` (Snowflake/VARIANT style, the
-- engine Allium uses). For a Postgres/Trino backend use `params->>'fieldName'`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Reusable enum-decoder macros (inlined as CASE since SQL lacks UDF portability)
-- -----------------------------------------------------------------------------
-- action_type CASE:
--   CASE params:actionType::int
--     WHEN 0 THEN 'CASH_DIVIDEND' WHEN 1 THEN 'STOCK_SPLIT'
--     WHEN 2 THEN 'STOCK_DIVIDEND' ELSE 'UNKNOWN' END
-- action_status CASE:
--   CASE s::int
--     WHEN 0 THEN 'ANNOUNCED' WHEN 1 THEN 'ROOT_PUBLISHED' WHEN 2 THEN 'CLAIMABLE'
--     WHEN 3 THEN 'FINALIZED' WHEN 4 THEN 'CANCELLED' ELSE 'UNKNOWN' END


-- =============================================================================
-- QUERY A — Action dataset (one row per corporate action)
-- Equivalent to the subgraph `CorporateAction` entity.
-- =============================================================================
WITH announced AS (
    SELECT
        params:id::string                       AS action_id,
        params:asset::string                    AS asset,
        CASE params:actionType::int
            WHEN 0 THEN 'CASH_DIVIDEND'
            WHEN 1 THEN 'STOCK_SPLIT'
            WHEN 2 THEN 'STOCK_DIVIDEND'
            ELSE 'UNKNOWN' END                  AS action_type,
        params:ratePerShare::string             AS rate_per_share,
        params:recordBlock::string              AS record_block,
        params:payableAt::string                AS payable_at,
        params:claimDeadline::string            AS claim_deadline,
        params:payoutToken::string              AS payout_token,
        params:metadataURI::string              AS metadata_uri,
        block_timestamp                         AS created_at,
        block_number                            AS created_at_block,
        transaction_hash                        AS tx_hash
    FROM decoded.logs
    WHERE address = LOWER(:registry)
      AND name = 'ActionAnnounced'
),

-- Latest published root per action (last write wins, though publishRoot is once).
roots AS (
    SELECT
        action_id, root, total_payout, holder_count
    FROM (
        SELECT
            params:id::string      AS action_id,
            params:root::string    AS root,
            params:totalPayout::string AS total_payout,
            params:holderCount::string AS holder_count,
            ROW_NUMBER() OVER (
                PARTITION BY params:id::string
                ORDER BY block_number DESC, log_index DESC
            ) AS rn
        FROM decoded.logs
        WHERE address = LOWER(:registry)
          AND name = 'MerkleRootPublished'
    )
    WHERE rn = 1
),

-- Latest status per action (chronologically last ActionStatusChanged.newStatus).
latest_status AS (
    SELECT action_id, new_status
    FROM (
        SELECT
            params:id::string        AS action_id,
            params:newStatus::int    AS new_status,
            ROW_NUMBER() OVER (
                PARTITION BY params:id::string
                ORDER BY block_number DESC, log_index DESC
            ) AS rn
        FROM decoded.logs
        WHERE address = LOWER(:registry)
          AND name = 'ActionStatusChanged'
    )
    WHERE rn = 1
),

-- Cumulative funded = max totalFunded reported (event carries the running total).
funded AS (
    SELECT
        params:id::string AS action_id,
        MAX(params:totalFunded::bigint) AS total_funded
    FROM decoded.logs
    WHERE address = LOWER(:distributor)
      AND name = 'Funded'
    GROUP BY 1
),

-- Cumulative claimed = sum of Claimed.amount (no running total emitted).
claimed AS (
    SELECT
        params:id::string AS action_id,
        SUM(params:amount::bigint) AS total_claimed
    FROM decoded.logs
    WHERE address = LOWER(:distributor)
      AND name = 'Claimed'
    GROUP BY 1
)

SELECT
    a.action_id,
    a.asset,
    a.action_type,
    -- Default to ANNOUNCED when no ActionStatusChanged has fired yet.
    CASE COALESCE(s.new_status, 0)
        WHEN 0 THEN 'ANNOUNCED'
        WHEN 1 THEN 'ROOT_PUBLISHED'
        WHEN 2 THEN 'CLAIMABLE'
        WHEN 3 THEN 'FINALIZED'
        WHEN 4 THEN 'CANCELLED'
        ELSE 'UNKNOWN' END                       AS status,
    a.rate_per_share,
    a.record_block,
    a.payable_at,
    a.claim_deadline,
    a.payout_token,
    r.root                                        AS merkle_root,
    r.total_payout,
    r.holder_count,
    COALESCE(f.total_funded, 0)                   AS total_funded,
    COALESCE(c.total_claimed, 0)                  AS total_claimed,
    a.metadata_uri,
    a.created_at,
    a.created_at_block,
    a.tx_hash
FROM announced a
LEFT JOIN roots         r ON r.action_id = a.action_id
LEFT JOIN latest_status s ON s.action_id = a.action_id
LEFT JOIN funded        f ON f.action_id = a.action_id
LEFT JOIN claimed       c ON c.action_id = a.action_id
ORDER BY TRY_CAST(a.action_id AS int);


-- =============================================================================
-- QUERY B — Claim dataset (one row per holder claim)
-- Equivalent to the subgraph `Claim` entity.
-- =============================================================================
SELECT
    transaction_hash || '-' || log_index   AS id,         -- matches subgraph id scheme
    params:id::string                       AS action_id,  -- FK to Query A.action_id
    params:index::string                    AS index,
    params:account::string                  AS account,    -- claim-on-behalf recipient
    params:amount::bigint                   AS amount,
    transaction_hash                        AS tx,
    block_timestamp                         AS timestamp,
    block_number                            AS block_number
FROM decoded.logs
WHERE address = LOWER(:distributor)
  AND name = 'Claimed'
ORDER BY block_number, log_index;


-- =============================================================================
-- QUERY C — Funding dataset (one row per Funded deposit)  [parity with `Funding`]
-- =============================================================================
SELECT
    transaction_hash || '-' || log_index   AS id,
    params:id::string                       AS action_id,
    params:from::string                     AS from_address,
    params:amount::bigint                   AS amount,
    params:totalFunded::bigint              AS total_funded,
    transaction_hash                        AS tx,
    block_timestamp                         AS timestamp,
    block_number                            AS block_number
FROM decoded.logs
WHERE address = LOWER(:distributor)
  AND name = 'Funded'
ORDER BY block_number, log_index;


-- =============================================================================
-- QUERY D — Sweep dataset (one row per UnclaimedSwept)  [parity with `Sweep`]
-- =============================================================================
SELECT
    transaction_hash || '-' || log_index   AS id,
    params:id::string                       AS action_id,
    params:to::string                       AS to_address,
    params:amount::bigint                   AS amount,
    transaction_hash                        AS tx,
    block_timestamp                         AS timestamp,
    block_number                            AS block_number
FROM decoded.logs
WHERE address = LOWER(:distributor)
  AND name = 'UnclaimedSwept'
ORDER BY block_number, log_index;
