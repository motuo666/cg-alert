# SEO 与增长清单（可自动化）

## 基础
- `sitemap.xml` 自动生成并提交（Google/Bing）。
- `robots.txt` 正确引导爬虫，不屏蔽重要页面。
- 每页唯一 `<title>`、`<meta name="description">`、唯一 `<h1>`。
- 语义化结构（article/section/aside/nav）、图片 `alt`。
- 结构化数据（JSON-LD：Product、FAQ、Breadcrumb、HowTo）。
- Open Graph / Twitter Card 完整。

## 性能
- LCP < 2.5s, CLS < 0.1, TBT < 200ms；
- 压缩（gzip/br）、图片自适应与懒加载、关键 CSS 提取。

## 内容
- 建立**主题集群（Topic Cluster）**：核心页面 + 支撑文章；
- 每周 2–3 篇支持文（可半自动用模板生成，人工校对）；
- 反向链接策略：客座、目录站、合作伙伴、案例研究。

## 自动化
- 依据关键词表生成草稿（模板 + 审核流程）；
- 自动生成与更新 `sitemap.xml`；
- 每次发布触发 ping 与社媒分发（Buffer/Zapier）。

