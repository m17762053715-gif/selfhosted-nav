import { defineConfig } from "vite";

// GitHub Pages 部署在子路径 /selfhosted-nav/ 下,需设置 base。
// 本地 dev/preview 用根路径,构建时按仓库名设子路径。
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/selfhosted-nav/" : "/",
});
