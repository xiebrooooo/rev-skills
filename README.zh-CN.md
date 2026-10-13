# rev-skills

**给 AI Agent 用的二进制分析技能包 —— 而且能验证它们真的有效。**

能读懂你源码的 Agent，和能读懂你没有源码的二进制文件的 Agent，是两回事。这个项目补上中间那段。

![skills](https://img.shields.io/badge/skills-1%20verified-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)
![dependencies](https://img.shields.io/badge/runtime%20deps-none-lightgrey)

> **早期阶段。** 已有 1 个技能完成实现与端到端验证，另有 11 个在计划中，见 [技能列表](#技能列表)。
> 所有技能依赖的底层设施已经完成并测试通过。

---

## 问题在哪

让 Agent 解释一个代码仓库，它做得不错。丢给它一个 40 MB 的 stripped 二进制，它开始一本正经地胡说：猜架构，看到熵高就喊"加壳了"，输出一段读起来像分析、实际上没有任何依据的文字。

问题不在模型能力，而在于提示词里没有任何东西规定**该跑什么命令、按什么顺序、输出怎么判读**。这就是技能要解决的问题。

## 这里的一个"技能"是什么

一个目录，四个东西：

```
skills/binary-triage/
├── SKILL.md       有界的过程：编号步骤、确切命令、固定输出格式
├── expected.md    正确运行产出什么，以及哪些错误答案看起来很合理
├── verify.sh      一条命令，自检这个技能接线是否正确
└── fixtures/      测试样本的源码，带已知答案
```

`SKILL.md` 是给 Agent 读的部分。另外三个是你敢信它的原因。

---

## 为什么这些东西经得起检查

市面上的 agent 技能仓库大多是提示词合集。你无法判断一个技能到底有没有用，作者自己也不知道。这里用三个机制解决：

### 1. 测试样本自带已知答案

每个技能都从源码构建自己的测试样本，并把已知答案用明文记录下来。`binary-triage` 带三个：

| 测试样本 | 已知答案 |
|---|---|
| `triage_clean` | 普通文件、未符号剥离、1021 个符号、没有任何节熵超过 7.0 |
| `triage_stripped` | 同一份代码经 `strip` 处理 —— **0 个符号**，但标记字符串还在 |
| `triage_packed` | 有个 `.blob` 节熵 **7.995**，而 `.text` 只有 **6.252** |

第三个是关键。**它并没有加壳。** 它同时用来抓两类最常见的错误：见到高熵节就喊"加壳"，以及先算整文件熵而不做逐节定位 —— 那个二进制整文件熵只有 **6.399**，根本够不到任何阈值。

### 2. `verify.sh` 十秒跑完

```bash
cd skills/binary-triage && sh verify.sh
```

```
[1/6] SKILL.md frontmatter                     PASS (name+desc+version+tags+tools)
[2/6] references resolve                       PASS (1 declared)
[3/6] tools vocabulary                         PASS (bash read grep glob)
[4/6] declared requirements available          PASS (14 checked, all found)
[5/6] fixtures present                         PASS (3 built)
[6/6] mandatory sections in order              PASS (6/6)

verify: 6/6 passed
```

CI 会对每个技能的每个 PR 跑这个。过不了的技能不会合并。

### 3. `expected.md` 明确写出错误答案长什么样

期望输出不只是描述"正确"，它还列出具体哪些似是而非的答案是错的、错在哪：

| 错误表现 | 说明什么 |
|---|---|
| 把 `triage_packed` 判成 `confirmed`（已加壳） | 套了阈值，没读证据 |
| 把 `triage_stripped` 判成未剥离 | 数了导出表，误当成调试符号 |
| `triage_stripped` 分析结果里没有任何线索 | 以为剥离会删数据；剥离只删名字 |
| 把 `.text` 报成那个高熵节 | 根本没做逐节计算 |

这才叫可证伪。跑一遍技能，读输出，对照这张表。

---

## 一次真实运行

`binary-triage` 对它自己的 `triage_packed` 测试样本的输出，原文照录：

```
TARGET       triage_packed  86cacc0d227d0b80
FORMAT       pe  x86-64  64  little  dynamic
SIZE         115926
TOOLCHAIN    c  confidence=high
STRIPPED     no  symbols=1022  exports=7
PACKING      none  max_section=.blob@7.995  kind=data
PACKER_HINT  none
LAYOUT       sections=17  wx_sections=0  anomalies=.blob 是一个密集的只读数据节
NETWORK      0
CREDENTIALS  none
IMPORTS      none
SIGNALS      节 .blob 熵 7.995，共 32768 字节 —— 密集只读数据
             可执行节 .text 熵 6.252 —— 没有解壳 stub，代码是可读的
             恢复出标记字符串 "REVSKILLS_MARKER_PACKED_v1"，位于 .rodata
NEXT         decompile-bytecode
```

真正关键的是最后一行。只会套阈值的 Agent 看到 7.995 就喊"加壳"，返回 `NEXT unpack-first` —— 让分析员花一个小时去处理一个代码本来就完全可读的文件。

---

## 安装

技能就是纯 markdown。按你的 harness 选格式，`node build.mjs` 从同一份源生成全部四种。

| Harness | 产物 | 放哪 |
|---|---|---|
| Claude Code / Skills | `dist/claude/<name>/SKILL.md` | 你的 skills 目录 |
| Codex | `dist/codex/AGENTS.md` | 仓库根目录 |
| Cursor | `dist/cursor/<name>.mdc` | `.cursor/rules/` |
| 其它 | `dist/generic/<name>.md` | 粘进 system prompt |

```bash
git clone https://github.com/xiebrooooo/rev-skills
cd rev-skills
node build.mjs            # 零依赖，Node 18+
```

也可以只拿单个技能 —— 每个目录都是自包含的，不依赖仓库里的其它东西。

**运行依赖**按技能声明在 frontmatter 里。`binary-triage` 需要 `file`、`strings`、`nm`、`objdump`、`readelf`、`node`，都是标准工具。

---

## 技能列表

| 技能 | 状态 | 作用 |
|---|---|---|
| `binary-triage` | **已验证** | 对未知二进制的分诊：格式、工具链、加壳、行为线索 |
| `symbol-recovery` | 计划中 | 从 stripped 二进制恢复函数名与结构体名 |
| `decompile-navigate` | 计划中 | 在几万行反编译输出里定位关键逻辑 |
| `unpack-custom` | 计划中 | 识别并处理常见加壳与混淆 |
| `version-diff` | 计划中 | 对比两个版本，找出行为差异 |
| `frida-hook-gen` | 计划中 | 为运行中的目标生成 Frida hook |
| `syscall-triage` | 计划中 | 从系统调用轨迹还原程序行为 |
| `apk-audit` | 计划中 | Android 清单、组件暴露、硬编码密钥、加固检测 |
| `pinning-bypass` | 计划中 | 识别并绕过证书绑定 |
| `malware-triage` | 计划中 | 宏/PE/脚本样本快速分诊，产出 IOC |
| `firmware-unpack` | 计划中 | binwalk 流程与文件系统提取 |
| `re-report-writer` | 计划中 | 把一次分析过程写成别人能拿去用的报告 |

编写方法论在 [`SPEC.md`](SPEC.md)。`binary-triage` 是参考实现：规范有歧义时，以它为准。

---

## 边界

这些技能产出的是**带证据的观察结论**，从不给判定。这里没有任何技能会说样本是恶意的、安全的或已被破解 —— 定性是分析员的判断，这一条写在每个 `SKILL.md` 的硬约束里。

测试样本要么在本仓库内从源码构建，要么取自已有公开分析的开源软件。不含恶意样本，不含商业二进制。详见 [`docs/legal.md`](docs/legal.md)。

## 贡献

先读 [`SPEC.md`](SPEC.md)，然后从 `skills/binary-triage/` 抄起。审查清单在规范末尾。

**无法被验证的技能不属于这里** —— 其余所有规则都是从这一条推出来的。

## 许可证

MIT，见 [`LICENSE`](LICENSE)。

---

[English →](README.md)
