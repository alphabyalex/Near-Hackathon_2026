/** Solo builders: shared by the Groups orbit and the Home leaderboard, so Home does not load the orbit. */
import type { GroupSummary } from "../api/ai";

export const SOLO_NAME = /\s*\(solo\)\s*$/i;
/**
 * A solo builder is a community of one: /v1/communities gives it members_count 1 (members here), an
 * id of bgt_ind_<name> and a name like "Ivan (solo)". Any one of these is enough.
 */
export const isSolo = (g: Pick<GroupSummary, "members" | "budget_id" | "name">): boolean => g.members <= 1 || g.budget_id.startsWith("bgt_ind_") || SOLO_NAME.test(g.name);
