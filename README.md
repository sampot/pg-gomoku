# pg-gomoku

瀏覽器五子棋（15×15）：雙人輪流、人機對弈、AI 對 AI 自動對弈。純前端，無建置步驟。

也可當作 [Playgrounds（遊樂場）](https://samkuo.me/playgrounds/) 的 **SAM**（`index.html` 入口）。

## 一鍵開 SAM 小

在遊樂場直接載入本儲存庫（需能連到 GitHub API）：

**[一鍵開 SAM 小](https://samkuo.me/playgrounds/?open=sampot%2Fpg-gomoku&name=%E4%BA%94%E5%AD%90%E6%A3%8B)**

等同網址：

```
https://samkuo.me/playgrounds/?open=sampot/pg-gomoku&name=五子棋
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

## 檔案

| 檔案 | 說明 |
| --- | --- |
| `index.html` | 頁面結構 |
| `styles.css` | 亮／暗色主題與版面 |
| `app.js` | Canvas 繪製、輸入、三種模式 |
| `gomoku.js` | 棋盤、勝負、評分 AI |
| `functions.js` | Playgrounds 可選 stub |

## License

MIT
