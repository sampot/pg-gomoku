# 五子棋（`pg-gomoku`）— 遊戲規劃文檔

> **用途：** 本 repo 的遊戲權威規格——coding agent 改動前必讀：這個遊戲是什麼、規則、設計限制、優化方向。
> **整理方式：** 從本 repo 實作反向整理（2026-08-23）。**改玩法先改此檔再改碼**；本檔與程式碼衝突時，以「規則（§3）」描述的設計意圖為準回報差異。
> **上游契約：** [PG-GAME-AGENT-GUIDE.md](https://github.com/sampot/playgrounds/blob/main/docs/PG-GAME-AGENT-GUIDE.md)（唯一必讀；本檔不重複其全文）· 型錄條目 `playgrounds/catalog/entries/pg-gomoku.yaml`

## 1. 一句話

15×15 無禁手五子棋：本機雙人／挑戰評分式 AI／AI 對 AI 觀戰，另經 `gomoku.v1` 邀請遠端對手（Host 選先手、短網址入座、包廂觀戰）；致敬通用五子棋玩法，非任一商業作品復刻。

## 2. 定案速覽

| 項 | 值 |
| --- | --- |
| catalog id / kind / series | `pg-gomoku` / `game` / `桌遊` |
| status / protocol | `listed`；`gomoku.v1`（roles `host`+`player` 各 1，`invite_only`） |
| 模式 | 本機：雙人／人機／AI 對 AI；連線：邀請對弈（含包廂主持／入座／觀戰） |
| 棋盤/勝負 | 15×15（`GOMOKU_BOARD_SIZE`）；先連五勝，滿盤 225 手平局；**無禁手** |
| 對手 AI | 單一難度：候選半徑 2 格評分式，攻擊 ×1.15 加權 |
| 素材 | 全程式繪製（木紋盤快取）＋系統字型；**無音效** |
| 持久化 | 人機連勝最高值 `pg-gomoku:highscore`（`window.PG.kv`）；session store `session:gomoku:v1`（`env.KV` 直綁） |
| 交付形 | ESM 純 JS＋Canvas；無 build；`npx vitest run` 測試 |

## 3. 完整規則（現行實作）

### 3.1 目標與勝負（`gomoku.js`）

- `board[y][x]`（row-major），黑＝1 先手、白＝2 後手；`makeMove(x,y)` 拒絕越界、重複位與終局後落子。
- 勝負：以最後一手為軸沿四方向（橫／縱／兩斜）雙向延伸，連成 **≥5** 即勝並記錄 `winningLine` 五子座標（`findWinningLine` 為純函式，本機與連線盤共用）。
- 滿盤（`moveCount ≥ 225`）無人連五 → `winner = 0` 平局。

### 3.2 AI 行為（`getBestMove`）

- 候選點：所有已有棋子切比雪夫距離 ≤2 的空格（首手無子時下天元 7,7）。
- 每點分數＝攻擊分 ×1.15 ＋防守分＋中心加權 `max(0, 14 − 曼哈頓距離)`；同分隨機取一。
- 方向評分（`evaluateDirection`，允許一個跳孔 `openGaps`）：連五 100000；活四 10000、衝四 1000；活三 1000、眠三 100；活二 100、眠二 10；其餘 `count + openGaps`。即「能贏先贏、擋四優先」由分數量級自然湧現。
- 節奏：人機模式 AI 於玩家落子後 180ms 出手；AI 對 AI 以 700ms setInterval 驅動（內部出手延遲 0ms）。

### 3.3 生命週期與殼層語境

- `visibilitychange(hidden)`／`pagehide` → 停 AI 定時器與座位輪詢、清 hover／thinking，並保留 resume 旗標（`lifecycle.js` 純函式）；恢復時僅在「仍是 AI 對 AI 且未終局」續跑 AI、仍在主持時續跑輪詢。
- `pg_surface`（query `pg_surface` → meta `pg:surface` → 預設 `solo`）：**solo** 只露本機三模式（隱藏本機/連線切換）；**room** 只連線——依序嘗試以 player 入座、每 250ms×20 次認領包廂主持席、退而觀戰（spectator）。

### 3.4 邀請對弈流程（UI 視角）

Host 按「開場」→「邀請對手」取得 `go.samkuo.me/i/…` 短網址（Guest 免註冊）→ Guest 同意入座（Host 每 2s 輪詢 seats 更新 presence）→ Host 選「誰先（執黑）」→「開始」（同時 revoke 邀請）→ 終局後 Host 可改先手按「再來一局」（同場直開下一局）。任何一方離席 → 整場結束，須重新開場（無同場重連）。

## 4. 操作與畫面

| 輸入 | 動作 |
| --- | --- |
| 點／觸棋盤交叉點 | 落子（本機輪流；連線僅自己回合且 status=active） |
| hover（僅 fine pointer） | 半透明落子預覽（自己的顏色、僅空格、僅自己回合） |
| 本機面板 | 開始雙人／挑戰 AI／AI 對 AI（進行中再按＝停止） |
| 連線面板 | 開場／邀請對手／誰先 radio／開始／再來一局／結束這一場／複製短網址 |
| 對局選單 | 重新開始、變更模式（非破壞性，不需確認） |

- Canvas 邏輯 600×600（CELL=40、PAD=20），DPR backing store 上限 2.5；木紋材質依主題色鍵快取；星位 (3,7,11)²；最後一手金／紅環、連五子描光暈。
- 版面由 `deriveChromeState` 推導：setup／match／guest（guest＝入座者與觀戰者，只見棋盤與狀態列）。Mobile-first；狀態訊息走 `role=status`；禁原生對話框。

## 5. 持久化（KV 權威）

| key | 內容 | 讀寫時機 |
| --- | --- | --- |
| `pg-gomoku:highscore`（KV） | 人機模式最高連勝（字串數字） | 開局 `window.PG.kv.get`（等 `pg.ready`）；刷新最高時 `put`。失敗靜默降級並提示「未能同步」 |
| `session:gomoku:v1`（KV，`env.KV` 直綁） | 對局全量 store：sessionId/channelName/seq/status(`waiting|ready|active|ended`)/turn/board/winner/lastMove/playerSeated/firstRole | functions.js 每次 open/state/presence/act/close 後整檔 PUT |

- 本 repo 不用裸 `localStorage` 存任何權威資料（刻意不走 LS→KV shim，避免同步 race）。
- 多人協定小節（`gomoku.v1`，常數集中在 `protocol.js`＝單一來源）：
  - roles `host`/`player` 各限 1 人、`joinPolicy: invite_only`、`capabilities: ["start","place","reset"]`、`firstStone: "black"`（先手固定執黑）。
  - acts：`start`（僅 host；payload `firstRole`；status 必須 ready）→ `match.started`；`place`（host/player；payload `row`,`col` 0..14；校驗輪次與空格）→ `match.placed`；`reset`（僅 host；僅 ended；席在則直達 active 併發 `match.started(rematch)`）→ `match.reset`。
  - 路由：Host UI 走 `/api/online/{open,close,status,domain,invite,invite/revoke}` → `env.HOST`（domain 僅轉發 `/api/session/*`，否則 403）；Guest 走 `env.SESSION` 的 `/api/session/{seat,channel,state,act,leave}`；domain 權威在 `/api/session/*`＋`env.KV`。
  - presence 中偵測離席：ready/active/ended 且對手未入座 → 發 `session.closed`（reason=`opponent_left`｜`host_closed`）並清空 store。錯誤映射：無 `env.HOST` 503、未登入通行證 `not_provisioned` 401、未開場 `session_inactive` 409。
  - 事件經 BroadcastChannel(channelName) 推送（type `session-event`），`seq` 單調遞增，UI 丟棄 `seq ≤ lastSeq` 的遲到訊息。

## 6. 美術／音效／署名

- 無外部圖像／字型資產：木紋棋盤、棋子、星位全由 canvas 程序繪製（`app.js`，`hash2` 決定性雜訊）；字型用系統 serif/sans 堆疊。詳 `ATTRIBUTION.md`。
- **本作無任何音效**（無 audio 模組）——新增音效時建 WebAudio 合成模組，勿引入取樣檔。
- 新增第三方素材：拷進 `assets/`、更新 `ATTRIBUTION.md`（CC0 也署名）、同步 `sam-manifest.json` files。

## 7. 測試（`npx vitest run`）

現有覆蓋（6 檔約 49 例）：`gomoku.test.js`（row-major 落子、橫／斜連五與勝利線座標、reset 清線、拒重複位、AI 返回合法點、`findWinningLine` 純函式）；`functions.test.js`（open/status/close/domain 轉發與 403 外溢、invite 建立／撤銷、無 HOST 503、`not_provisioned`→401、Guest SESSION 座位、離席清場 ready+active 兩態）；`ui-state.test.js`（setup/match/guest 版型推導、觀戰藏選單、ended 回 setup）；`shellSurface.test.js`（query＞meta＞solo）；`lifecycle.test.js`（suspend/resume 旗標合併與條件恢復）；`sources.test.js`（全模組語法可解析、重複宣告偵偵測、殼層 boot 與 capabilities 宣告、首手選擇不被輪詢覆寫等原始碼斷言）。

缺口：`getBestMove` 評分表（活四/衝四量級）與 functions.js 的 act 校驗矩陣（非 host start/reset、未輪到落子、越界座標）無直接單元測試。改 AI 或協定必補。

## 8. 硬約束（不可違反）

1. 僅 HTML＋CSS＋JS（ESM）；**無 build**、不入庫 `node_modules`、不安套件；工具一律 `npx <pkg>` 臨時執行。
2. 禁瀏覽器原生 `alert`／`confirm`／`prompt`；訊息一律狀態列 flash。
3. Mobile-first；主操作不可 hover-only（hover 幽靈子只是增強）。
4. 分數唯一權威＝宿主 `/api/kv`（經 `window.PG.kv`）；session 權威＝`env.KV` 的 `session:gomoku:v1`；禁裸 localStorage 當權威。
5. 不自行載入 `sdk.js`；宿主注入 `window.PG`（KV 不可用須能照玩本機）。
6. 改動可執行邏輯前先寫失敗測試（TDD）。
7. 檔案清單變動須同步 `sam-manifest.json`。
8. `gomoku.v1` 行為變更須同步 `protocol.js`（單一來源）、型錄 protocols 與 `functions.test.js`；不得破壞 seq 去重、role↔stone 映射與離席清場語義。

## 9. 優化建議（可玩性與樂趣）

依優先級；實作前先在此登記並補測試。原則：強化對弈手感與重玩誘因，不改變「無禁手自由五子」的核心認同。

**高優先**

1. **落子音效**：現行完全無聲。新增 WebAudio 合成模組（落子木質嗒聲＋勝利短琶音），附音效開關——對弈類最便宜的臨場感來源。
2. **AI 難度三段**（入門／標準／兇猛）：調候選半徑（2→1/2/3）、攻擊偏權（1.0/1.15/1.3）與是否允許跳孔即可，風險低；解決單一難度兩極化。
3. **戰績擴充**：`pg-gomoku:highscore` 只存連勝；擴成 JSON（總局/勝/敗/平 vs AI）存 KV，HUD 顯示生涯勝率——給人機模式跨局目標。

**中優先**

4. **禁手選項**（三三／四四／長連）：規則核心已是集中式 `makeMove`，加家規開關與判定分支即可；滿足想練競技規則的玩家。
5. **悔棋**（人機模式一次一手）：保存手數堆疵，AI 回合撤兩手；降低新手挫敗感。
6. **AI 提示模式**：「指點我」開關讓 AI 在你猶豫 5 秒後閃示推薦點——教學與陪玩兼得。

**低優先**

7. **棋譜覆盤**：終局後按手數回放（本機模式暫存即可），也利於驗證 AI 改動。
8. **連勝里程碑 toast**：3／5／10 連勝顯示稱號，搭配既有 KV 連勝值。
