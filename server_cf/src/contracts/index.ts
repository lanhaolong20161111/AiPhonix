/**
 * 契约层转发 —— 单一事实来源在 server_ts/src/contracts/index.ts
 * （web 经 Vite 别名 @contracts 也指向它；架构评审 P2-10b 消除双端漂移）。
 * 本文件仅做转发，请勿在此复制 schema，否则会与 server_ts 再次漂移。
 */
export * from "../../../server_ts/src/contracts/index.js"
