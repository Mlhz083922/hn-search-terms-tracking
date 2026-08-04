# HN Search Terms Tracking 只读站

把 `docs/` 目录发布到 GitHub Pages，供团队只读查看女装泳装关键词的 ABA 排名与搜索量数据。

## 更新数据快照

1. 在本地主站完成编辑后，重新生成只读快照：

   ```bash
   node build-readonly.mjs
   ```

2. 提交并推送 `main` 分支：

   ```bash
   git add -A
   git commit -m "update read-only snapshot"
   git push origin main
   ```

GitHub Pages 会自动重新发布，网址保持不变：

https://Mlhz083922.github.io/hn-search-terms-tracking/
