# CSV Explorer

CSV の構造、列、値の変化、時系列傾向をブラウザだけで素早く確認する、グラフ中心の汎用 Explorer です。ファイルは外部へ送信されません。

## 開発

```bash
npm install
npm run dev
npm test
npm run build
```

## アーキテクチャ

`CSV → Format Adapter → ParsedDataset → 共通 UI` の一方向です。React コンポーネントは入力 CSV 固有の行位置や名前を知りません。共通モデルは `src/models/dataset.ts`、登録表は `src/services/formatRegistry.ts` にあります。

`ParsedDataset` は `metadata`、型と統計を持つ `columns`、列 ID をキーとする `rows` で構成されます。`ColumnType` は number / boolean / category / text / datetime / code です。

## 新しい CSV フォーマットを追加する

### 1. Adapter を実装

`src/formats/myFormat/index.ts` を作り、次の interface を実装します。

```ts
interface CsvFormatAdapter {
  id: string;
  name: string;
  detect(context: ParseContext): number;
  parse(context: ParseContext, confidence?: number): ParsedDataset;
}
```

### 2. detector を作る

`detect` はファイル名と先頭部分など、安価に調べられる特徴から `0..1` の confidence を返します。単一の弱い特徴だけで高得点にせず、固有マーカー、ヘッダ構造、拡張子など独立した特徴を加点してください。解析に失敗し得る入力では例外ではなく低い値を返します。

### 3. parser を作る

`parse` は固有のメタ行、グループ行、ヘッダ、単位、データ開始位置、時刻合成だけを担当し、必ず共通 `ParsedDataset` を返します。汎用の区切り推定、引用符対応 CSV 分割、型推定、列統計は `src/services/csv.ts` を再利用できます。合成した時刻列は通常列として追加し、`metadata.xAxisId` に設定します。固有条件を React 側へ追加しないでください。

### 4. registry へ登録

`src/services/formatRegistry.ts` で adapter を import し、`formats` 配列へ追加します。これだけで自動判定と手動選択肢の両方へ表示され、既存グラフ、列フィルタ、表を変更せず利用できます。

### 自動判定とフォールバック

Auto は全 adapter の confidence を比較し、最高得点を採用します。十分な confidence（現在 `0.35`）がない入力は `Generic CSV` へフォールバックします。Generic adapter は区切りを推定し、先頭行をヘッダとして各列を型推定します。手動選択時は指定 adapter で同じ元テキストを再解析します。

## 対応機能

- Generic CSV、Trace CSV (`trc_*.csv`)、安川サーボトレースCSVの自動判定・手動再解析
- ファイル選択または画面へのドラッグ＆ドロップ、Auto detect決定形式の明示
- UTF-8 / Shift_JIS（Windows-31J）をファイル内容から判定してブラウザ内でデコード
- 安川形式の作成日時、サーボパック形式、モータ形式、グループ、単位、データ開始行を保持
- 検索、変化列フィルタ、型推定、複数列選択
- ECharts の tooltip、凡例、ズーム、パン、復元、画像保存
- I/Oグループの0/1列をBooleanとして認識するstep波形、時刻候補または行番号の X 軸
- 安川形式の時間データは元のms値を保持したまま、グラフX軸では秒（s）へ変換
- X軸は先頭・末尾と切りの良い中間値を表示し、Boolean信号は数値波形の下へ個別に同期表示
- 数値グラフとBoolean段で左右のプロット境界を統一し、同時刻を同じ垂直位置へ描画
- 数値X軸は約20分割を目安にし、ズーム範囲に応じてEChartsが目盛り間隔と本数を自動調整
- 個別Y軸、正規化、同期した段組み表示
- グラフ右クリックから該当行へ移動できる、IndexedDBベースの連続仮想スクロールData表
- 左のチェックで系列を追加・削除し、選択系列ごとに色・実線／破線／点線・線幅を設定（上の凡例は確認専用）

## 大きなファイル

グラフはアニメーションを無効化し LTTB sampling と ECharts の large mode を利用します。列フィルタと X 軸候補は memoize され、Data 表はIndexedDBから一度に60行だけ読み込んで描画します。非常に大きなファイルでは、将来 parser を Web Worker へ移す余地を Adapter 境界が提供します。
