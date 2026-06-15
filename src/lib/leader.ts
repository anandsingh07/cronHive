import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { logger } from "./logger.js";
import { isLeaderGauge } from "./metrics.js";

const log = logger.child({ component: "leader" });

const LEADER_KEY = "cronhive:scheduler:leader";

// Renew the lease via an atomic compare-and-extend: only the current leader (matching
// token) may push the TTL forward. Prevents a partitioned old leader from clobbering a
// newly elected one.
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface LeaderElection {
  /** True only while this instance currently holds leadership. */
  isLeader(): boolean;
  /** Stop campaigning and relinquish leadership if held. */
  stop(): Promise<void>;
}

/**
 * Single-leader election over Redis.
 *
 * Exactly one scheduler instance becomes leader at a time; only the leader scans and
 * enqueues. A leader holds a TTL'd key carrying a unique token and renews it on a
 * heartbeat (well within the TTL). If the leader dies, the key expires and a follower
 * acquires it on its next attempt — automatic failover with a bounded gap (≈ leaseTtlMs).
 *
 * This is intentionally a lightweight lease, not full Raft. For a single-coordinator
 * scheduler it gives the needed property (one active scanner, automatic failover) without
 * the operational weight of a consensus cluster.
 */
export function startLeaderElection(
  redis: Redis,
  opts: { leaseTtlMs?: number; heartbeatMs?: number } = {}
): LeaderElection {
  const leaseTtlMs = opts.leaseTtlMs ?? 10_000;
  const heartbeatMs = opts.heartbeatMs ?? Math.floor(leaseTtlMs / 3);
  const token = randomUUID();
  let leader = false;
  let stopped = false;

  const setLeader = (val: boolean) => {
    if (val !== leader) {
      leader = val;
      isLeaderGauge.set(val ? 1 : 0);
      log.info({ leader: val, token }, val ? "became leader" : "lost leadership");
    }
  };

  const campaign = async () => {
    if (stopped) return;
    try {
      if (leader) {
        // Renew our lease.
        const renewed = await redis.eval(RENEW_SCRIPT, 1, LEADER_KEY, token, String(leaseTtlMs));
        if (renewed !== 1) setLeader(false); // lost it (e.g. we were partitioned)
      } else {
        // Try to acquire leadership.
        const res = await redis.set(LEADER_KEY, token, "PX", leaseTtlMs, "NX");
        if (res === "OK") setLeader(true);
      }
    } catch (err) {
      log.error({ err }, "leader campaign error");
      setLeader(false);
    }
  };

  void campaign();
  const timer = setInterval(() => void campaign(), heartbeatMs);

  return {
    isLeader: () => leader,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      if (leader) {
        try {
          await redis.eval(RELEASE_SCRIPT, 1, LEADER_KEY, token);
        } catch {
          /* best effort */
        }
        setLeader(false);
      }
    },
  };
}
