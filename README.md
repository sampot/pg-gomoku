# pg-gomoku

瀏覽器五子棋（15×15）：雙人輪流、人機對弈、AI 對 AI 自動對弈。純前端，無建置步驟。

也可當作 [Playgrounds（遊樂場）](https://play.samkuo.me/) 的 **SAM**（`index.html` 入口）。

## 一鍵開 SAM 小

在遊樂場直接載入本儲存庫（需能連到 GitHub API）：

**[一鍵開 SAM 小](https://play.samkuo.me/?open=sampot%2Fpg-gomoku&name=%E4%BA%94%E5%AD%90%E6%A3%8B)**

等同網址：

```
https://play.samkuo.me/?open=sampot/pg-gomoku&name=五子棋
```

同源會重用本機已匯入的沙盒；要強制新建可加 `&fresh=1`。

## 試玩（本機）

用任何靜態伺服器開啟此目錄，例如：

```bash
npx --yes serve .
# 或
python3 -m http.server 8080
```

瀏覽器打開顯示的網址即可。

## 操作

| 按鈕 | 行為 |
| --- | --- |
| （直接點棋盤） | 雙人模式輪流落子 |
| **開始 AI 對弈** | 您執黑，白棋由啟發式 AI 應手；再按一次改回雙人 |
| **AI 對 AI 自動對弈** | 雙方皆由 AI 自動落子；進行中再按可停止 |
| **重新開始** | 清空棋盤（AI 對 AI 會停並回到雙人） |

規則：先連成五子者勝；棋盤滿且無人勝則平局。無禁手。

## 邀請對弈（Playgrounds）

在遊樂場（`play`）或純玩版（`go`）開啟本 SAM 後切到 **邀請對弈**：

1. Host（已登入遊樂場通行證）按 **開場** → **邀請對手**；殼頁會彈出短網址／QR（`https://go.samkuo.me/i/…`）。
2. Guest（無需註冊）開短連結 → 同意入座。
3. Host 見對手入座後**選誰先**（先手固定執黑），再按 **開始**。
4. 終局後 Host 可改先手再按 **再來一局**。

Session protocol：`gomoku.v1`。UI 經本 SAM `/api/online/*` → `env.HOST`（DEC-053）；Guest 經 `env.SESSION`。見 [PG-INVITE-E2E-MVP](https://github.com/sampot/playgrounds/blob/main/docs/PG-INVITE-E2E-MVP.md)。

## 檔案

| 檔案 | 說明 |
| --- | --- |
| `index.html` | 頁面結構；`sam:protocol`／`sam:capabilities` |
| `styles.css` | 亮／暗色主題與版面 |
| `app.js` | Canvas、本機三種模式、邀請對弈 UI（`/api/online/*`） |
| `gomoku.js` | 棋盤、勝負、評分 AI |
| `protocol.js` | `gomoku.v1` 常數 |
| `functions.js` | Host session domain＋`env.HOST` UI 代理 |

## License

MIT
