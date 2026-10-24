# Cornea-Optics Ablation-OS | 眼科雷射角膜全屈光消融視覺化系統

本專案實作眼科現代雷射角膜屈光手術（LASIK / PRK / 全飛秒 SMILE）之核心消融與透鏡雕刻演算法，提供純前端、無須安裝任何開發環境即可直接執行的 **互動式 2D/3D Web 地形視覺化模擬器**。

---

## 📁 專案架構

```text
Ablation-algorithm/
├── index.html       # 醫療級暗黑儀表板介面 (2D 雷射熱圖 / 3D 角膜曲率地形 / 軸向切削截面)
├── style.css        # Cyber-Medical 儀器風格樣式與動態微光效果
├── app.js           # 完整全屈光模擬引擎 (散光、近視、遠視、老花、SMILE 全飛秒)
├── start.bat        # Windows 一鍵啟動 Web 視覺化腳本 (Port 8080)
└── README.md        # 專案詳細說明文件
```

---

## ⚡ 快速啟動方式

1. 在資料夾中直接雙擊 **`start.bat`**。
2. 系統將自動啟動本地 Web 伺服器並以瀏覽器開啟：[http://localhost:8080/](http://localhost:8080/)。
3. 支援切換以下六大臨床屈光手術模式：
   - 🎯 **單純散光 (Astigmatism)**：沿軸度 $\theta$ 進行雙側對稱幾何切削（外積 CCW 相交判定）。
   - 👓 **單純近視 (Myopia)**：Munnerlyn 公式中央球狀削平。
   - 🌟 **近視 + 散光 (Compound)**：台灣臨床最常見之複合屈光手術。
   - 🔬 **全飛秒 SMILE**：微爆破電漿微氣泡掃描，內建 **「取出微透鏡」** 互動模擬。
   - 🔎 **遠視消融 (Hyperopia)**：周邊環形切削（Annular Ring），使中央角膜變陡。
   - 👵 **老花多焦 (Presbyopia / PresbyMAX)**：非球面雙焦近用閱讀塑形。

---

## 🔬 演算法核心幾何原理

- **CCW（Counter-Clockwise 外積逆時針演算法）**：
  判定三點幾何轉向關係，提供無浮點誤差的計算幾何基礎。
- **線段相交判定 (`intersection`)**：
  以兩組外積相乘 $\le 0$ 快速判定角膜點與雷射光斑弦線之相交關係。
- **散光柱面雙側切削**：
  沿散光軸度 $\theta$ 正負兩側以極座標旋轉向量建立對稱光斑區域，修正角膜散光曲率。
- **SMILE 基質透鏡雕刻**：
  雙層飛秒微爆破分離面（Cap 120 $\mu m$ + Posterior Lenticule）及 2mm 微創小切口取出機制。
