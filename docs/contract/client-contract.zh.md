# 客户端契约 — 撤回 seq

另一个插件如何获知**哪些 Chat 节点被回退撤回**。这是该问题的唯一受支持
答案；未在此列出的内容均属内部实现，可随时变更，恕不另行通知。本文档
跟随当前插件线，版本对齐见发布说明。

## 稳定性分级

| 通道 | 稳定性 | 适用方 |
| --- | --- | --- |
| 本插件引擎命令 `args` 中的 `@<seq>`（`rewind-plugin`；旧会话为 `rewind`） | ✅ 稳定，受 semver 保护 | 机器 |
| `outcome.sourceEventSeq`（marker 日志 seq） | ✅ 稳定，受 semver 保护 | 机器 |
| `dsh-rewind-plugin/client` 导出的 `hiddenSeqsOf` / `targetSeqOfArgs` / `HiddenChat` | ✅ 稳定，受 semver 保护 | 机器 |
| `outcome.text` | ❌ **不**稳定 — 人类可读文案，禁止解析 | — |

## 唯一机器通道

`dsh-rewind-plugin/client` 导出插件自身使用的纯函数，与本地化无关，不读取
DOM，也不解析 host 文案。

```ts
import { hiddenSeqsOf, targetSeqOfArgs, type HiddenChat } from 'dsh-rewind-plugin/client'

const chat = uiConversation.binding(sessionId).target('chat')?.getSnapshot() // `uiConversation` 的 "chat" 视图
const hidden = hiddenSeqsOf(chat as HiddenChat) // 被撤回的 seq 集合
```

传入刚从 live view 读取的 snapshot，不要保留它。`hiddenSeqsOf` 优先读取
store 的 `nodes.values()`（因此已被 visibility 层隐藏的节点仍参与计算），
旧快照回退到 `order`。结果按 snapshot wrapper 缓存，每次调用返回新的
`Set`。

集合包含：

- 所有遗留内部探针行（`preview` / `__candidates`），无论处于什么状态；
- 所有携带 marker（`sourceEventSeq`）的成功引擎命令行；
- 所有 `anchorSeq` 落在某次回退 `[target, marker]` 区间内的节点。

每次回退切一条区间；重叠区间合并，相邻区间不合并，所以早先 marker 与
后来 target 之间仍在新流量保持可见。失败的命令、没有 marker 的成功命令
既不贡献命令行，也不贡献区间。Group shell 与 Turn-process 摘要属于呈现
结构，不属于本稳定集合；空摘要由 visibility 层直接隐藏。

`targetSeqOfArgs(args)` 从命令原始 `args` 中取第一个 `@<digits>` target。
它只是解析辅助，不做合法性校验。

## 快照可见性

撤回节点在 Chat builder 计算 `order` 之前被标为 `visibility: 'hidden'`：
它们离开 `order`、分组、Turn location 和已加载的 Turn 导航，React 行也
不会挂载；但节点仍留在 `nodes.values()` 中，供输入框回填和
`hiddenSeqsOf` 使用。

没有 DOM 行隐藏，也没有 `data-dsh-rewind-hidden` 属性。依赖该属性的
消费者必须迁移到 `hiddenSeqsOf`。

Turn 导轨不属于隐藏范围：它还会合并 host 的 `turnOutline`，因此完全
hidden 的 Turn 仍可能以 unloaded mark 出现。不要把它当作可见性保证。

## 明确非契约

`outcome.text` 是面向人类用户的文案，解析它即视为 bug。以下内容同样不
稳定：DOM 属性（`data-chat-*` 或任何 rewind 标记）、Turn 导轨状态、已注册
builder 的内部形状，以及 group / Turn-process 锚点。

## 维护规则

- 任何改变已列通道语义的改动，必须在同一 PR 中更新本文档。
- 破坏已承诺的稳定性分级属于 minor/major 版本变更。
- `scripts/build.mjs` 在每次构建时断言公开 client 导出面。
