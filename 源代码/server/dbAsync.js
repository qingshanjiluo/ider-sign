/**
 * dbAsync.js — Phase 1 异步数据库层
 *
 * 将 db.js 的所有同步函数包装为 async，返回 Promise。
 * Phase 2: 路由逐步切换为 import dbAsync 并 await 调用。
 * Phase 3: 本文件内部替换为真正的 mysql2/promise 异步查询。
 * Phase 4: 维护模式 → 数据迁移 → 切换 DB_DRIVER=mysql。
 */

const db = require('./db');

// ─── 直接透传（非异步数据库操作） ──────────────────────────
// db.db       — 原始 better-sqlite3 / sync-mysql 句柄，仅供极端场景
// db.isMysql  — boolean 标志
// db.getDateKey — 纯计算工具函数
// db.prefetchPlayerAsync — 已经是 async

// ─── 通用异步包装器 ──────────────────────────────────────
// 将同步函数包装为 async：在 Phase 1 中只是 return syncFn(...args)，
// 因为 async 函数自动将返回值包装为 resolved Promise。
// Phase 3 时替换为真正的异步实现。

function wrapAsync(syncFn) {
  return async function (...args) {
    return syncFn(...args);
  };
}

// ─── 账号 (Accounts) ────────────────────────────────────
const createAccount              = typeof db.createAccountAsync === 'function'
  ? db.createAccountAsync
  : wrapAsync(db.createAccount);
const getAccountByUsername        = typeof db.getAccountByUsernameAsync === 'function'
  ? db.getAccountByUsernameAsync
  : wrapAsync(db.getAccountByUsername);
const getAccountByUsernameCaseInsensitive = typeof db.getAccountByUsernameCaseInsensitiveAsync === 'function'
  ? db.getAccountByUsernameCaseInsensitiveAsync
  : getAccountByUsername;
const getAccountById              = typeof db.getAccountByIdAsync === 'function'
  ? db.getAccountByIdAsync
  : wrapAsync(db.getAccountById);
const findAccountByRegisterTraits = typeof db.findAccountByRegisterTraitsAsync === 'function'
  ? db.findAccountByRegisterTraitsAsync
  : wrapAsync(db.findAccountByRegisterTraits);
const verifyPassword              = wrapAsync(db.verifyPassword);
const verifyPasswordDetailed      = wrapAsync(db.verifyPasswordDetailed);
const insertMachineLoginLog       = typeof db.insertMachineLoginLogAsync === 'function'
  ? db.insertMachineLoginLogAsync
  : wrapAsync(db.insertMachineLoginLog);
const getAccountsByMachineId      = typeof db.getAccountsByMachineIdAsync === 'function'
  ? db.getAccountsByMachineIdAsync
  : wrapAsync(db.getAccountsByMachineId);
const getAccountsByCurrentMachineId = typeof db.getAccountsByCurrentMachineIdAsync === 'function'
  ? db.getAccountsByCurrentMachineIdAsync
  : wrapAsync(db.getAccountsByCurrentMachineId);
const getMachineShareBanCount     = typeof db.getMachineShareBanCountAsync === 'function'
  ? db.getMachineShareBanCountAsync
  : wrapAsync(db.getMachineShareBanCount);
const isMachineShareExempt        = typeof db.isMachineShareExemptAsync === 'function'
  ? db.isMachineShareExemptAsync
  : wrapAsync(db.isMachineShareExempt);
const getCheatScanExemptUntil     = typeof db.getCheatScanExemptUntilAsync === 'function'
  ? db.getCheatScanExemptUntilAsync
  : wrapAsync(db.getCheatScanExemptUntil);
const isCheatScanExempt           = typeof db.isCheatScanExemptAsync === 'function'
  ? db.isCheatScanExemptAsync
  : wrapAsync(db.isCheatScanExempt);
const setCheatScanExemptUntil     = typeof db.setCheatScanExemptUntilAsync === 'function'
  ? db.setCheatScanExemptUntilAsync
  : wrapAsync(db.setCheatScanExemptUntil);
const clearExpiredBan             = typeof db.clearExpiredBanAsync === 'function'
  ? db.clearExpiredBanAsync
  : wrapAsync(db.clearExpiredBan);
const isAccountBanned             = typeof db.isAccountBannedAsync === 'function'
  ? db.isAccountBannedAsync
  : wrapAsync(db.isAccountBanned);
const banAccountMachineShare      = typeof db.banAccountMachineShareAsync === 'function'
  ? db.banAccountMachineShareAsync
  : wrapAsync(db.banAccountMachineShare);
const setAccountBanned            = typeof db.setAccountBannedAsync === 'function'
  ? db.setAccountBannedAsync
  : wrapAsync(db.setAccountBanned);
const updateAccountMachineId      = typeof db.updateAccountMachineIdAsync === 'function'
  ? db.updateAccountMachineIdAsync
  : wrapAsync(db.updateAccountMachineId);
const updateAccountLoginIp        = typeof db.updateAccountLoginIpAsync === 'function'
  ? db.updateAccountLoginIpAsync
  : wrapAsync(db.updateAccountLoginIp);
const getAccountsByMachineIdAndIp = typeof db.getAccountsByMachineIdAndIpAsync === 'function'
  ? db.getAccountsByMachineIdAndIpAsync
  : wrapAsync(db.getAccountsByMachineIdAndIp);
const getAccountsByLoginIp        = typeof db.getAccountsByLoginIpAsync === 'function'
  ? db.getAccountsByLoginIpAsync
  : wrapAsync(db.getAccountsByLoginIp);

// ─── IP 封禁 (IP Bans) ─────────────────────────────────
const getIpBan   = typeof db.getIpBanAsync === 'function'
  ? db.getIpBanAsync
  : wrapAsync(db.getIpBan);
const isIpBanned = typeof db.isIpBannedAsync === 'function'
  ? db.isIpBannedAsync
  : wrapAsync(db.isIpBanned);
const banIp      = typeof db.banIpAsync === 'function'
  ? db.banIpAsync
  : wrapAsync(db.banIp);
const unbanIp    = typeof db.unbanIpAsync === 'function'
  ? db.unbanIpAsync
  : wrapAsync(db.unbanIp);

// ─── 玩家 (Players) ────────────────────────────────────
const getPlayerByAccountId       = typeof db.getPlayerByAccountIdAsync === 'function'
  ? db.getPlayerByAccountIdAsync
  : wrapAsync(db.getPlayerByAccountId);
const savePlayer                 = wrapAsync(db.savePlayer);
const savePlayerImmediate        = typeof db.savePlayerImmediateAsync === 'function'
  ? db.savePlayerImmediateAsync
  : wrapAsync(db.savePlayerImmediate);
const getPlayerRuntimeState      = typeof db.getPlayerRuntimeStateAsync === 'function'
  ? db.getPlayerRuntimeStateAsync
  : wrapAsync(db.getPlayerRuntimeState);
const updatePlayerAutoBattleIntent = typeof db.updatePlayerAutoBattleIntentAsync === 'function'
  ? db.updatePlayerAutoBattleIntentAsync
  : wrapAsync(db.updatePlayerAutoBattleIntent);
const updatePlayerRestUntil      = typeof db.updatePlayerRestUntilAsync === 'function'
  ? db.updatePlayerRestUntilAsync
  : wrapAsync(db.updatePlayerRestUntil);
const updatePlayerLastActivity   = typeof db.updatePlayerLastActivityAsync === 'function'
  ? db.updatePlayerLastActivityAsync
  : wrapAsync(db.updatePlayerLastActivity);
const listAllPlayersRaw          = typeof db.listAllPlayersRawAsync === 'function'
  ? db.listAllPlayersRawAsync
  : wrapAsync(db.listAllPlayersRaw);
const listAutoBattlePlayerRows   = typeof db.listAutoBattlePlayerRowsAsync === 'function'
  ? db.listAutoBattlePlayerRowsAsync
  : wrapAsync(db.listAutoBattlePlayerRows);
const listPendingJobPlayerRows   = typeof db.listPendingJobPlayerRowsAsync === 'function'
  ? db.listPendingJobPlayerRowsAsync
  : wrapAsync(db.listPendingJobPlayerRows);
const countPlayersBySect         = typeof db.countPlayersBySectAsync === 'function'
  ? db.countPlayersBySectAsync
  : wrapAsync(db.countPlayersBySect);
const listPlayerBriefAll         = typeof db.listPlayerBriefAllAsync === 'function'
  ? db.listPlayerBriefAllAsync
  : wrapAsync(db.listPlayerBriefAll);
const listLeagueLeaderboardRows  = typeof db.listLeagueLeaderboardRowsAsync === 'function'
  ? db.listLeagueLeaderboardRowsAsync
  : wrapAsync(db.listLeagueLeaderboardRows);
const listLeagueTeamRankRows     = typeof db.listLeagueTeamRankRowsAsync === 'function'
  ? db.listLeagueTeamRankRowsAsync
  : wrapAsync(db.listLeagueTeamRankRows);
const countLeagueTeamRankRows    = typeof db.countLeagueTeamRankRowsAsync === 'function'
  ? db.countLeagueTeamRankRowsAsync
  : wrapAsync(db.countLeagueTeamRankRows);
const listLeagueMatchesByTeam    = typeof db.listLeagueMatchesByTeamAsync === 'function'
  ? db.listLeagueMatchesByTeamAsync
  : wrapAsync(db.listLeagueMatchesByTeam);
const listLeagueTeamsByMemberAccount = typeof db.listLeagueTeamsByMemberAccountAsync === 'function'
  ? db.listLeagueTeamsByMemberAccountAsync
  : wrapAsync(db.listLeagueTeamsByMemberAccount);
const listLeagueTeamNamesByIds = typeof db.listLeagueTeamNamesByIdsAsync === 'function'
  ? db.listLeagueTeamNamesByIdsAsync
  : wrapAsync(db.listLeagueTeamNamesByIds);
const isPlayerNameTaken          = typeof db.isPlayerNameTakenAsync === 'function'
  ? db.isPlayerNameTakenAsync
  : wrapAsync(db.isPlayerNameTaken);

// ─── 战斗会话 (Battle Sessions) ────────────────────────
const createBattleSession         = typeof db.createBattleSessionAsync === 'function'
  ? db.createBattleSessionAsync
  : wrapAsync(db.createBattleSession);
const getBattleSession            = typeof db.getBattleSessionAsync === 'function'
  ? db.getBattleSessionAsync
  : wrapAsync(db.getBattleSession);
const getActiveBattleSessionByAccount = typeof db.getActiveBattleSessionByAccountAsync === 'function'
  ? db.getActiveBattleSessionByAccountAsync
  : wrapAsync(db.getActiveBattleSessionByAccount);
const updateBattleSessionState    = typeof db.updateBattleSessionStateAsync === 'function'
  ? db.updateBattleSessionStateAsync
  : wrapAsync(db.updateBattleSessionState);
const appendBattleCommand         = typeof db.appendBattleCommandAsync === 'function'
  ? db.appendBattleCommandAsync
  : wrapAsync(db.appendBattleCommand);
const getBattleCommand            = typeof db.getBattleCommandAsync === 'function'
  ? db.getBattleCommandAsync
  : wrapAsync(db.getBattleCommand);
const appendBattleEvents          = typeof db.appendBattleEventsAsync === 'function'
  ? db.appendBattleEventsAsync
  : wrapAsync(db.appendBattleEvents);
const listBattleEventsSince       = typeof db.listBattleEventsSinceAsync === 'function'
  ? db.listBattleEventsSinceAsync
  : wrapAsync(db.listBattleEventsSince);
const finishBattleSession         = typeof db.finishBattleSessionAsync === 'function'
  ? db.finishBattleSessionAsync
  : wrapAsync(db.finishBattleSession);
const deleteBattleSession         = typeof db.deleteBattleSessionAsync === 'function'
  ? db.deleteBattleSessionAsync
  : wrapAsync(db.deleteBattleSession);

// ─── 副本 (Dungeon) ────────────────────────────────────
const getDungeonCompletionsToday     = typeof db.getDungeonCompletionsTodayAsync === 'function'
  ? db.getDungeonCompletionsTodayAsync
  : wrapAsync(db.getDungeonCompletionsToday);
const incrementDungeonCompletions    = typeof db.incrementDungeonCompletionsAsync === 'function'
  ? db.incrementDungeonCompletionsAsync
  : wrapAsync(db.incrementDungeonCompletions);
const getSectTaskCompletionsToday    = typeof db.getSectTaskCompletionsTodayAsync === 'function'
  ? db.getSectTaskCompletionsTodayAsync
  : wrapAsync(db.getSectTaskCompletionsToday);
const incrementSectTaskCompletions   = typeof db.incrementSectTaskCompletionsAsync === 'function'
  ? db.incrementSectTaskCompletionsAsync
  : wrapAsync(db.incrementSectTaskCompletions);
const saveDungeonBattle              = typeof db.saveDungeonBattleAsync === 'function'
  ? db.saveDungeonBattleAsync
  : wrapAsync(db.saveDungeonBattle);
const getDungeonBattle               = typeof db.getDungeonBattleAsync === 'function'
  ? db.getDungeonBattleAsync
  : wrapAsync(db.getDungeonBattle);
const deleteDungeonBattle            = typeof db.deleteDungeonBattleAsync === 'function'
  ? db.deleteDungeonBattleAsync
  : wrapAsync(db.deleteDungeonBattle);
const countActiveDungeonBattles      = typeof db.countActiveDungeonBattlesAsync === 'function'
  ? db.countActiveDungeonBattlesAsync
  : wrapAsync(db.countActiveDungeonBattles);
const deleteAllDungeonBattlesForAccount = typeof db.deleteAllDungeonBattlesForAccountAsync === 'function'
  ? db.deleteAllDungeonBattlesForAccountAsync
  : wrapAsync(db.deleteAllDungeonBattlesForAccount);
const cleanupExpiredDungeonBattles   = typeof db.cleanupExpiredDungeonBattlesAsync === 'function'
  ? db.cleanupExpiredDungeonBattlesAsync
  : wrapAsync(db.cleanupExpiredDungeonBattles);

// ─── 副本组队 (Dungeon Teams) ──────────────────────────
const createDungeonTeam = typeof db.createDungeonTeamAsync === 'function'
  ? db.createDungeonTeamAsync
  : wrapAsync(db.createDungeonTeam);
const touchDungeonTeam  = typeof db.touchDungeonTeamAsync === 'function'
  ? db.touchDungeonTeamAsync
  : wrapAsync(db.touchDungeonTeam);
const joinDungeonTeam   = typeof db.joinDungeonTeamAsync === 'function'
  ? db.joinDungeonTeamAsync
  : wrapAsync(db.joinDungeonTeam);
const getDungeonTeam    = typeof db.getDungeonTeamAsync === 'function'
  ? db.getDungeonTeamAsync
  : wrapAsync(db.getDungeonTeam);
const getMyDungeonTeam  = typeof db.getMyDungeonTeamAsync === 'function'
  ? db.getMyDungeonTeamAsync
  : wrapAsync(db.getMyDungeonTeam);
const leaveDungeonTeam  = typeof db.leaveDungeonTeamAsync === 'function'
  ? db.leaveDungeonTeamAsync
  : wrapAsync(db.leaveDungeonTeam);

// ─── 交易所 (Exchange) ─────────────────────────────────
const createExchangeListing          = typeof db.createExchangeListingAsync === 'function'
  ? db.createExchangeListingAsync
  : wrapAsync(db.createExchangeListing);
const getExchangeListingById         = typeof db.getExchangeListingByIdAsync === 'function'
  ? db.getExchangeListingByIdAsync
  : wrapAsync(db.getExchangeListingById);
const listExchangeListings           = typeof db.listExchangeListingsAsync === 'function'
  ? db.listExchangeListingsAsync
  : wrapAsync(db.listExchangeListings);
const listMyExchangeListings         = typeof db.listMyExchangeListingsAsync === 'function'
  ? db.listMyExchangeListingsAsync
  : wrapAsync(db.listMyExchangeListings);
const updateExchangeListingAfterTrade = typeof db.updateExchangeListingAfterTradeAsync === 'function'
  ? db.updateExchangeListingAfterTradeAsync
  : wrapAsync(db.updateExchangeListingAfterTrade);
const cancelExchangeListing          = typeof db.cancelExchangeListingAsync === 'function'
  ? db.cancelExchangeListingAsync
  : wrapAsync(db.cancelExchangeListing);
const settleExpiredExchangeListings  = typeof db.settleExpiredExchangeListingsAsync === 'function'
  ? db.settleExpiredExchangeListingsAsync
  : wrapAsync(db.settleExpiredExchangeListings);
const createExchangeTrade            = typeof db.createExchangeTradeAsync === 'function'
  ? db.createExchangeTradeAsync
  : wrapAsync(db.createExchangeTrade);
const listExchangeTradePrices        = typeof db.listExchangeTradePricesAsync === 'function'
  ? db.listExchangeTradePricesAsync
  : wrapAsync(db.listExchangeTradePrices);

// ─── 邮箱 (Mailbox) ────────────────────────────────────
const createMailboxMessage = typeof db.createMailboxMessageAsync === 'function'
  ? db.createMailboxMessageAsync
  : wrapAsync(db.createMailboxMessage);
const listMailbox          = typeof db.listMailboxAsync === 'function'
  ? db.listMailboxAsync
  : wrapAsync(db.listMailbox);
const getMailboxById       = typeof db.getMailboxByIdAsync === 'function'
  ? db.getMailboxByIdAsync
  : wrapAsync(db.getMailboxById);
const claimMailboxAtomic   = typeof db.claimMailboxAtomicAsync === 'function'
  ? db.claimMailboxAtomicAsync
  : wrapAsync(db.claimMailboxAtomic);
const markMailboxClaimed   = typeof db.markMailboxClaimedAsync === 'function'
  ? db.markMailboxClaimedAsync
  : wrapAsync(db.markMailboxClaimed);
const unmarkMailboxClaimed = typeof db.unmarkMailboxClaimedAsync === 'function'
  ? db.unmarkMailboxClaimedAsync
  : wrapAsync(db.unmarkMailboxClaimed);
const deleteClaimedMailbox = typeof db.deleteClaimedMailboxAsync === 'function'
  ? db.deleteClaimedMailboxAsync
  : wrapAsync(db.deleteClaimedMailbox);

// ─── 斗法 / 战神榜 (City Duel) ────────────────────────
const createCityDuelLog            = typeof db.createCityDuelLogAsync === 'function'
  ? db.createCityDuelLogAsync
  : wrapAsync(db.createCityDuelLog);
const listCityDuelLogsByAccount    = typeof db.listCityDuelLogsByAccountAsync === 'function'
  ? db.listCityDuelLogsByAccountAsync
  : wrapAsync(db.listCityDuelLogsByAccount);
const countCityDuelChallengesToday = typeof db.countCityDuelChallengesTodayAsync === 'function'
  ? db.countCityDuelChallengesTodayAsync
  : wrapAsync(db.countCityDuelChallengesToday);
const insertCityDuelChallenge      = typeof db.insertCityDuelChallengeAsync === 'function'
  ? db.insertCityDuelChallengeAsync
  : wrapAsync(db.insertCityDuelChallenge);
const getDuelRankLastSettledPeriod  = typeof db.getDuelRankLastSettledPeriodAsync === 'function'
  ? db.getDuelRankLastSettledPeriodAsync
  : wrapAsync(db.getDuelRankLastSettledPeriod);
const getTopDuelRankAccount = typeof db.getTopDuelRankAccountAsync === 'function'
  ? db.getTopDuelRankAccountAsync
  : wrapAsync(db.getTopDuelRankAccount);
const resetAllDuelRankScores = typeof db.resetAllDuelRankScoresAsync === 'function'
  ? db.resetAllDuelRankScoresAsync
  : wrapAsync(db.resetAllDuelRankScores);
const setDuelRankLastSettledPeriod  = typeof db.setDuelRankLastSettledPeriodAsync === 'function'
  ? db.setDuelRankLastSettledPeriodAsync
  : wrapAsync(db.setDuelRankLastSettledPeriod);

// ─── 仙盟 (Alliance) ───────────────────────────────────
const listAlliances                            = typeof db.listAlliancesAsync === 'function' ? db.listAlliancesAsync : wrapAsync(db.listAlliances);
const createAlliance                           = typeof db.createAllianceAsync === 'function' ? db.createAllianceAsync : wrapAsync(db.createAlliance);
const getAllianceById                           = typeof db.getAllianceByIdAsync === 'function' ? db.getAllianceByIdAsync : wrapAsync(db.getAllianceById);
const getAllianceByName                         = typeof db.getAllianceByNameAsync === 'function' ? db.getAllianceByNameAsync : wrapAsync(db.getAllianceByName);
const updateAlliance                           = typeof db.updateAllianceAsync === 'function' ? db.updateAllianceAsync : wrapAsync(db.updateAlliance);
const listAllianceMembers                      = typeof db.listAllianceMembersAsync === 'function' ? db.listAllianceMembersAsync : wrapAsync(db.listAllianceMembers);
const addAllianceMember                        = typeof db.addAllianceMemberAsync === 'function' ? db.addAllianceMemberAsync : wrapAsync(db.addAllianceMember);
const removeAllianceMember                     = typeof db.removeAllianceMemberAsync === 'function' ? db.removeAllianceMemberAsync : wrapAsync(db.removeAllianceMember);
const updateAllianceMemberRank                 = typeof db.updateAllianceMemberRankAsync === 'function' ? db.updateAllianceMemberRankAsync : wrapAsync(db.updateAllianceMemberRank);
const getAllianceMemberRank                    = typeof db.getAllianceMemberRankAsync === 'function' ? db.getAllianceMemberRankAsync : wrapAsync(db.getAllianceMemberRank);
const createAllianceApplication                = typeof db.createAllianceApplicationAsync === 'function' ? db.createAllianceApplicationAsync : wrapAsync(db.createAllianceApplication);
const renewAllianceApplication                 = typeof db.renewAllianceApplicationAsync === 'function' ? db.renewAllianceApplicationAsync : wrapAsync(db.renewAllianceApplication);
const listAlliancePendingApplications          = typeof db.listAlliancePendingApplicationsAsync === 'function' ? db.listAlliancePendingApplicationsAsync : wrapAsync(db.listAlliancePendingApplications);
const updateAllianceApplicationStatus          = typeof db.updateAllianceApplicationStatusAsync === 'function' ? db.updateAllianceApplicationStatusAsync : wrapAsync(db.updateAllianceApplicationStatus);
const getApplicationByAllianceAndAccount       = typeof db.getApplicationByAllianceAndAccountAsync === 'function' ? db.getApplicationByAllianceAndAccountAsync : wrapAsync(db.getApplicationByAllianceAndAccount);
const getApplicationByAllianceAndAccountAnyStatus = typeof db.getApplicationByAllianceAndAccountAnyStatusAsync === 'function' ? db.getApplicationByAllianceAndAccountAnyStatusAsync : wrapAsync(db.getApplicationByAllianceAndAccountAnyStatus);
const getApplicationById                       = typeof db.getApplicationByIdAsync === 'function' ? db.getApplicationByIdAsync : wrapAsync(db.getApplicationById);
const countAllianceMembersByRank               = typeof db.countAllianceMembersByRankAsync === 'function' ? db.countAllianceMembersByRankAsync : wrapAsync(db.countAllianceMembersByRank);
const addAllianceMemberContribution            = typeof db.addAllianceMemberContributionAsync === 'function' ? db.addAllianceMemberContributionAsync : wrapAsync(db.addAllianceMemberContribution);
const getAllianceMemberContribution            = typeof db.getAllianceMemberContributionAsync === 'function' ? db.getAllianceMemberContributionAsync : wrapAsync(db.getAllianceMemberContribution);
const addAllianceWithdrawAuth                  = typeof db.addAllianceWithdrawAuthAsync === 'function' ? db.addAllianceWithdrawAuthAsync : wrapAsync(db.addAllianceWithdrawAuth);
const removeAllianceWithdrawAuth               = typeof db.removeAllianceWithdrawAuthAsync === 'function' ? db.removeAllianceWithdrawAuthAsync : wrapAsync(db.removeAllianceWithdrawAuth);
const hasAllianceWithdrawAuth                  = typeof db.hasAllianceWithdrawAuthAsync === 'function' ? db.hasAllianceWithdrawAuthAsync : wrapAsync(db.hasAllianceWithdrawAuth);
const listAllianceWithdrawAuth                 = typeof db.listAllianceWithdrawAuthAsync === 'function' ? db.listAllianceWithdrawAuthAsync : wrapAsync(db.listAllianceWithdrawAuth);

// ─── 邀请系统 (Invite) ─────────────────────────────────
const getOrCreateInviter       = typeof db.getOrCreateInviterAsync === 'function' ? db.getOrCreateInviterAsync : wrapAsync(db.getOrCreateInviter);
const getInviterByCode         = typeof db.getInviterByCodeAsync === 'function' ? db.getInviterByCodeAsync : wrapAsync(db.getInviterByCode);
const getInviteBinding         = typeof db.getInviteBindingAsync === 'function' ? db.getInviteBindingAsync : wrapAsync(db.getInviteBinding);
const createInviteBinding      = typeof db.createInviteBindingAsync === 'function' ? db.createInviteBindingAsync : wrapAsync(db.createInviteBinding);
const updateInviteBindingStones = typeof db.updateInviteBindingStonesAsync === 'function' ? db.updateInviteBindingStonesAsync : wrapAsync(db.updateInviteBindingStones);
const updateInviterStorage     = typeof db.updateInviterStorageAsync === 'function' ? db.updateInviterStorageAsync : wrapAsync(db.updateInviterStorage);
const getInviterStorage        = typeof db.getInviterStorageAsync === 'function' ? db.getInviterStorageAsync : wrapAsync(db.getInviterStorage);
const addInviterPoints         = typeof db.addInviterPointsAsync === 'function' ? db.addInviterPointsAsync : wrapAsync(db.addInviterPoints);
const deductInviterStones      = typeof db.deductInviterStonesAsync === 'function' ? db.deductInviterStonesAsync : wrapAsync(db.deductInviterStones);
const listInvitees             = typeof db.listInviteesAsync === 'function' ? db.listInviteesAsync : wrapAsync(db.listInvitees);
const hasClaimedInvitePoints   = typeof db.hasClaimedInvitePointsAsync === 'function' ? db.hasClaimedInvitePointsAsync : wrapAsync(db.hasClaimedInvitePoints);
const claimInvitePoints        = typeof db.claimInvitePointsAsync === 'function' ? db.claimInvitePointsAsync : wrapAsync(db.claimInvitePoints);
const deductInvitePoints       = typeof db.deductInvitePointsAsync === 'function' ? db.deductInvitePointsAsync : wrapAsync(db.deductInvitePoints);

// ─── 邮箱绑定 / 密码 (Email & Password) ────────────────
const createEmailVerificationCode = typeof db.createEmailVerificationCodeAsync === 'function'
  ? db.createEmailVerificationCodeAsync
  : wrapAsync(db.createEmailVerificationCode);
const verifyEmailCode             = typeof db.verifyEmailCodeAsync === 'function'
  ? db.verifyEmailCodeAsync
  : wrapAsync(db.verifyEmailCode);
const bindAccountEmail            = typeof db.bindAccountEmailAsync === 'function'
  ? db.bindAccountEmailAsync
  : wrapAsync(db.bindAccountEmail);
const unbindAccountEmail          = typeof db.unbindAccountEmailAsync === 'function'
  ? db.unbindAccountEmailAsync
  : wrapAsync(db.unbindAccountEmail);
const getAccountEmail             = typeof db.getAccountEmailAsync === 'function'
  ? db.getAccountEmailAsync
  : wrapAsync(db.getAccountEmail);
const isEmailTaken                = typeof db.isEmailTakenAsync === 'function'
  ? db.isEmailTakenAsync
  : wrapAsync(db.isEmailTaken);
const getRecentEmailCodeTime      = typeof db.getRecentEmailCodeTimeAsync === 'function'
  ? db.getRecentEmailCodeTimeAsync
  : wrapAsync(db.getRecentEmailCodeTime);
const getAccountByEmail           = typeof db.getAccountByEmailAsync === 'function'
  ? db.getAccountByEmailAsync
  : wrapAsync(db.getAccountByEmail);
const updateAccountPassword       = typeof db.updateAccountPasswordAsync === 'function'
  ? db.updateAccountPasswordAsync
  : wrapAsync(db.updateAccountPassword);

// ─── 兑换码 (Redemption) ───────────────────────────────
const hasAccountRedeemed      = typeof db.hasAccountRedeemedAsync === 'function'
  ? db.hasAccountRedeemedAsync
  : wrapAsync(db.hasAccountRedeemed);
const recordAccountRedemption = typeof db.recordAccountRedemptionAsync === 'function'
  ? db.recordAccountRedemptionAsync
  : wrapAsync(db.recordAccountRedemption);
const wipeAccountData         = typeof db.wipeAccountDataAsync === 'function'
  ? db.wipeAccountDataAsync
  : wrapAsync(db.wipeAccountData);

// ─── 缓存控制 ──────────────────────────────────────────
const flushPlayerCache         = wrapAsync(db.flushPlayerCache);
const invalidatePlayerReadCache = wrapAsync(db.invalidatePlayerReadCache);
const clearAllPlayerReadCache   = wrapAsync(db.clearAllPlayerReadCache);

// ─── 导出 ──────────────────────────────────────────────
module.exports = {
  // 透传（非 async 包装）
  db: db.db,
  isMysql: db.isMysql,
  getDateKey: db.getDateKey,
  prefetchPlayerAsync: db.prefetchPlayerAsync,

  // 缓存控制
  flushPlayerCache,
  invalidatePlayerReadCache,
  clearAllPlayerReadCache,

  // 账号
  createAccount,
  getAccountByUsername,
  getAccountByUsernameCaseInsensitive,
  getAccountById,
  findAccountByRegisterTraits,
  verifyPassword,
  verifyPasswordDetailed,
  insertMachineLoginLog,
  getAccountsByMachineId,
  getAccountsByCurrentMachineId,
  getMachineShareBanCount,
  isMachineShareExempt,
  getCheatScanExemptUntil,
  isCheatScanExempt,
  setCheatScanExemptUntil,
  clearExpiredBan,
  isAccountBanned,
  banAccountMachineShare,
  setAccountBanned,
  updateAccountMachineId,
  updateAccountLoginIp,
  getAccountsByMachineIdAndIp,
  getAccountsByLoginIp,

  // IP 封禁
  getIpBan,
  isIpBanned,
  banIp,
  unbanIp,

  // 玩家
  getPlayerByAccountId,
  savePlayer,
  savePlayerImmediate,
  getPlayerRuntimeState,
  updatePlayerAutoBattleIntent,
  updatePlayerRestUntil,
  updatePlayerLastActivity,
  listAllPlayersRaw,
  listAutoBattlePlayerRows,
  listPendingJobPlayerRows,
  countPlayersBySect,
  listPlayerBriefAll,
  listLeagueLeaderboardRows,
  listLeagueTeamRankRows,
  countLeagueTeamRankRows,
  listLeagueMatchesByTeam,
  listLeagueTeamsByMemberAccount,
  listLeagueTeamNamesByIds,
  isPlayerNameTaken,

  // 战斗会话
  createBattleSession,
  getBattleSession,
  getActiveBattleSessionByAccount,
  updateBattleSessionState,
  appendBattleCommand,
  getBattleCommand,
  appendBattleEvents,
  listBattleEventsSince,
  finishBattleSession,
  deleteBattleSession,

  // 副本
  getDungeonCompletionsToday,
  incrementDungeonCompletions,
  getSectTaskCompletionsToday,
  incrementSectTaskCompletions,
  saveDungeonBattle,
  getDungeonBattle,
  deleteDungeonBattle,
  countActiveDungeonBattles,
  deleteAllDungeonBattlesForAccount,
  cleanupExpiredDungeonBattles,

  // 副本组队
  createDungeonTeam,
  touchDungeonTeam,
  joinDungeonTeam,
  getDungeonTeam,
  getMyDungeonTeam,
  leaveDungeonTeam,

  // 交易所
  createExchangeListing,
  getExchangeListingById,
  listExchangeListings,
  listMyExchangeListings,
  updateExchangeListingAfterTrade,
  cancelExchangeListing,
  settleExpiredExchangeListings,
  createExchangeTrade,
  listExchangeTradePrices,

  // 邮箱
  createMailboxMessage,
  listMailbox,
  getMailboxById,
  claimMailboxAtomic,
  markMailboxClaimed,
  unmarkMailboxClaimed,
  deleteClaimedMailbox,

  // 斗法 / 战神榜
  createCityDuelLog,
  listCityDuelLogsByAccount,
  countCityDuelChallengesToday,
  insertCityDuelChallenge,
  getDuelRankLastSettledPeriod,
  getTopDuelRankAccount,
  resetAllDuelRankScores,
  setDuelRankLastSettledPeriod,

  // 仙盟
  listAlliances,
  createAlliance,
  getAllianceById,
  getAllianceByName,
  updateAlliance,
  listAllianceMembers,
  addAllianceMember,
  removeAllianceMember,
  updateAllianceMemberRank,
  getAllianceMemberRank,
  createAllianceApplication,
  renewAllianceApplication,
  listAlliancePendingApplications,
  updateAllianceApplicationStatus,
  getApplicationByAllianceAndAccount,
  getApplicationByAllianceAndAccountAnyStatus,
  getApplicationById,
  countAllianceMembersByRank,
  addAllianceMemberContribution,
  getAllianceMemberContribution,
  addAllianceWithdrawAuth,
  removeAllianceWithdrawAuth,
  hasAllianceWithdrawAuth,
  listAllianceWithdrawAuth,

  // 邀请系统
  getOrCreateInviter,
  getInviterByCode,
  getInviteBinding,
  createInviteBinding,
  updateInviteBindingStones,
  updateInviterStorage,
  getInviterStorage,
  addInviterPoints,
  deductInviterStones,
  listInvitees,
  hasClaimedInvitePoints,
  claimInvitePoints,
  deductInvitePoints,

  // 邮箱绑定 / 密码
  createEmailVerificationCode,
  verifyEmailCode,
  bindAccountEmail,
  unbindAccountEmail,
  getAccountEmail,
  isEmailTaken,
  getRecentEmailCodeTime,
  getAccountByEmail,
  updateAccountPassword,

  // 兑换码
  hasAccountRedeemed,
  recordAccountRedemption,
  wipeAccountData,
};
