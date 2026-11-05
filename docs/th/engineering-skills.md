# skill ด้านวิศวกรรม

Stack Agent มี skill ของตัวเอง 12 ตัว (`verify`, `debug`, `reflect` และอื่นๆ ดู [README](../../README.th.md)) และอีก 28 ตัวสำหรับงานวิศวกรรมประจำวัน: พัฒนาแบบเขียนเทสต์ก่อน รีวิวโค้ด เขียนเนื้อหา pull request สร้างแบบจำลองโดเมน วางแผนด้วยตั๋ว และอื่นๆ 28 ตัวนี้เริ่มจาก skill ของ [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) แล้วถูกเปลี่ยนชื่อ รวม อัปเดต และเขียนใหม่เป็นส่วนใหญ่ที่นี่ [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) บอกว่าแต่ละตัวห่างจากต้นฉบับแค่ไหน หน้านี้บอกว่าแต่ละตัวเริ่มอย่างไร ต้องมีอะไร และเปลี่ยนอะไรบ้าง เพื่อให้เพื่อนร่วมทีมใช้ได้ตั้งแต่วันที่ติดตั้ง plugin

[English](../engineering-skills.md)

## ติดตั้งและเริ่มใช้

```bash
claude plugin marketplace add Brown248/Stack_Agent
```

```bash
claude plugin install stack-agent@stack-agent-marketplace
```

เริ่ม Claude Code ใหม่ skill เริ่มได้สองทาง:

- **ด้วยการขอ** 9 จาก 28 ตัวอยู่ในรายการที่ Claude เห็น และมันจะโหลดตัวที่ตรงกับคำขอ พูดว่า "ทำแบบเขียนเทสต์ก่อน" แล้ว `tdd` จะโหลด
- **ด้วยการพิมพ์ชื่อ** อีก 19 ตัวเริ่มเมื่อคุณพิมพ์ `/stack-agent:<ชื่อ>` เท่านั้น เช่น `/stack-agent:triage` Claude ไม่โหลดมันเองจากประโยคธรรมดา ห้าตัวในนั้นเปลี่ยนเครื่องหรือ repo ของคุณ (ดู "สิ่งที่เปลี่ยนเครื่องหรือ repo ของคุณ") จึงรอให้คุณสั่ง

ถ้าไม่แน่ใจว่าตัวไหนเหมาะ พิมพ์ `/stack-agent:which-skill` มันอ่าน skill ที่ติดตั้งอยู่จริงแล้วบอกว่า skill หรือขั้นตอนไหนเหมาะกับสถานการณ์ของคุณ รูปสั้น (`/tdd`) ใช้ได้เช่นกันตราบที่ plugin อื่นไม่มี skill ชื่อเดียวกัน ถ้าชนกันให้ใช้รูปเต็ม `/stack-agent:`

## ไม่มี issue tracker

งานประจำวันส่วนใหญ่ไม่ต้องใช้:

| ต้องการ | พูดหรือพิมพ์ |
| --- | --- |
| สร้างฟีเจอร์หรือแก้บั๊กแบบเขียนเทสต์ก่อน | "ทำแบบ test-first" (`tdd`) |
| รีวิวสิ่งที่เปลี่ยนตั้งแต่ commit, branch หรือ tag | "รีวิว diff ตั้งแต่ main" (`code-review`) |
| เขียนเนื้อหา pull request | "เขียนคำอธิบาย PR" (`pr`) |
| ตกลงชื่อเรียกและจดการตัดสินใจ | "มาตกลงศัพท์ลง glossary กัน" (`domain-modeling`) |
| ออกแบบ interface ของ module ให้ลึกขึ้น | "seam ควรอยู่ตรงไหน" (`codebase-design`) |
| ลองไอเดียด้วยโค้ดทิ้ง | "ทำ prototype สามแบบ" (`prototype`) |
| หาข้อมูลพร้อมแหล่งอ้างอิง | "ค้นว่า X จัดการ Y อย่างไร" (`research`) |
| ให้ถามจี้แผนของคุณ | "grill แผนนี้หน่อย" (`grilling`) |
| เขียนหรือแก้ skill, `CLAUDE.md`, `AGENTS.md` | "ช่วยเขียน SKILL.md นี้" (`writing-for-agents`) |
| บั๊กทุกแบบ รวมบั๊กยากและช้า | "ช่วยหาและแก้บั๊กนี้" (`debug`) |
| ส่งงานให้ agent อีกตัว | `/stack-agent:handoff` |

## มี issue tracker (GitHub, GitLab หรือโฟลเดอร์ในเครื่อง)

รัน `/stack-agent:setup-workflow` หนึ่งครั้งใน repo มันถามว่าใช้ tracker อะไร ใช้ป้ายอะไรตอน triage และ glossary กับบันทึกการตัดสินใจอยู่ที่ไหน แล้วจดไว้ใน `.stack-agent/workflow/` (ไม่แตะ `CLAUDE.md` หรือ `AGENTS.md`) ตัวเลือก local เก็บตั๋วเป็นไฟล์ Markdown ใต้ `.scratch/` ใน repo ไม่ต้องมีบัญชี หลังจากนั้น:

1. `/stack-agent:grilling` ถามจี้แผนให้ชัด ถ้า repo มี `GLOSSARY.md` หรือ `docs/adr/` ก็เขียน glossary กับการตัดสินใจไปด้วย
2. `/stack-agent:to-spec` แปลงบทสนทนาเป็น spec และ `/stack-agent:to-tickets` แบ่งเป็นตั๋วบางๆ ที่ระบุว่าอะไรขวางอะไร
3. `/stack-agent:implement` สร้างตั๋วหนึ่งใบ หรือ `/stack-agent:implement-spec` สร้างทั้ง spec บน feature branch เดียว โดยใช้ subagent ต่อตั๋ว
4. `/stack-agent:triage` ย้าย issue ที่เข้ามาและ pull request จากภายนอกผ่านสถานะต่างๆ และ `/stack-agent:wayfinder` วางแผนงานที่ใหญ่เกินหนึ่ง session

## 28 skill

"พิมพ์" คือเริ่มด้วย `/stack-agent:<ชื่อ>` "ขอ" คือ Claude โหลดเองจากคำขอได้

| Skill | เริ่ม | ทำอะไร | ต้องมี |
| --- | --- | --- | --- |
| `tdd` | ขอ | red-green-refactor ทีละชิ้น เทสต์อยู่ที่ seam ที่ตกลงกัน | `GLOSSARY.md` ถ้า repo มี |
| `code-review` | ขอ | รีวิวตั้งแต่จุดที่กำหนดสองแกน คือ Standards กับ Spec รายงานอย่างเดียว | git; tracker หรือไฟล์ spec |
| `codebase-design` | ขอ | ศัพท์สำหรับ module ลึก, seam, interface | ไม่ต้อง |
| `domain-modeling` | ขอ | สร้าง glossary และ ADR ไปพร้อมการคุย | เขียน `GLOSSARY.md`, `docs/adr/` |
| `pr` | ขอ | เนื้อหา PR: สรุปเป็นภาพ หลักฐานก่อน/หลัง การประเมินอันตรายของการ merge | ไม่ต้อง |
| `prototype` | ขอ | โค้ดทิ้งเพื่อตอบคำถามการออกแบบ | ตัวรันของโปรเจกต์เองสำหรับแบบ UI |
| `research` | ขอ | ผลสืบค้นพร้อมแหล่งอ้างอิงเก็บเป็น Markdown รันเบื้องหลัง | เข้าเว็บได้ |
| `grilling` | ขอ | ถามจี้แผนไม่หยุด และจด glossary กับการตัดสินใจถ้า repo มี | เขียนเอกสารเฉพาะตอนนั้น |
| `writing-for-agents` | ขอ | วิธีเขียน skill, `CLAUDE.md`, `AGENTS.md` | ไม่ต้อง |
| `which-skill` | พิมพ์ | skill หรือขั้นตอนไหนเหมาะ | ไม่ต้อง |
| `handoff` | พิมพ์ | ย่อบทสนทนาให้ agent อีกตัวรับช่วง | ไม่ต้อง |
| `retro` | พิมพ์ | เสนอการปรับสภาพแวดล้อมของ agent หลัง session | log ของ session เก่า |
| `teach` | พิมพ์ | สอนแนวคิดในโฟลเดอร์ทดลอง | เขียนโน้ตในโฟลเดอร์ทำงาน |
| `to-questionnaire` | พิมพ์ | แปลงเรื่องที่ยังตัดสินไม่ได้เป็นคำถามให้คนอื่นตอบ | ไม่ต้อง |
| `re-explain` | พิมพ์ | "ข้อความล่าสุดไม่เข้าใจ": พูดซ้ำเป็นประโยคสั้นๆ ที่ตรงๆ | ไม่ต้อง |
| `improve-codebase-architecture` | พิมพ์ | หาจุดทำให้ลึกขึ้น แสดงรายงาน HTML | เบราว์เซอร์; อินเทอร์เน็ตสำหรับสคริปต์ของรายงาน |
| `setup-workflow` | พิมพ์ | ตั้งค่า tracker ป้าย และเอกสารครั้งเดียว เขียนลง `.stack-agent/workflow/` | git; `gh` หรือ `glab` ถ้าไม่ใช้ local |
| `to-spec` | พิมพ์ | เผยแพร่ spec ลง tracker | tracker |
| `to-tickets` | พิมพ์ | ตั๋วบางๆ พร้อมเส้นขวางกัน | tracker หรือไฟล์ในเครื่อง |
| `triage` | พิมพ์ | issue และ pull request จากภายนอกผ่าน state machine | tracker |
| `wayfinder` | พิมพ์ | แผนที่ของตั๋วการตัดสินใจสำหรับงานใหญ่มาก | tracker |
| `implement` | พิมพ์ | สร้าง spec หรือตั๋วด้วย `tdd` แล้วตรวจและรีวิว | tracker |
| `implement-spec` | พิมพ์ | ทั้ง spec บน feature branch เดียว subagent ต่อตั๋ว | tracker, git worktree |
| `git-guardrails` | พิมพ์ | ติดตั้ง hook ที่บล็อก `git push`, `reset --hard`, `clean`, `branch -D` | Node 22 |
| `setup-pre-commit` | พิมพ์ | Husky, lint-staged กับ Prettier, typecheck และเทสต์ตอน commit | npm, pnpm, yarn หรือ bun |
| `step-script` | พิมพ์ | สคริปต์ bash พาคนทำขั้นตอนที่มีแต่คนทำได้ | bash (Git Bash หรือ WSL บน Windows), `gh`, `.env` |
| `scaffold-exercises` | พิมพ์ | โฟลเดอร์แบบฝึกหัดตามโครงของคอร์ส | repo ที่จัดโครงตามเครื่องมือของคอร์สนั้น |
| `migrate-to-shoehorn` | พิมพ์ | เปลี่ยน `as` ในเทสต์เป็น `@total-typescript/shoehorn` | npm, TypeScript |

## สิ่งที่เปลี่ยนเครื่องหรือ repo ของคุณ

ตัวเหล่านี้เริ่มเมื่อคุณพิมพ์เท่านั้น และแต่ละตัวทำสิ่งที่ควรรู้ก่อน:

- `git-guardrails` เขียน `~/.claude/settings.json` และ `~/.claude/hooks/` ได้ (ถามก่อนว่าเฉพาะโปรเจกต์หรือทุกโปรเจกต์) บล็อก `git push` ธรรมดาทุกแบบ ซึ่ง Stack Agent อนุญาต hook เป็นสคริปต์ Node เล็กๆ จึงไม่ต้องมี `jq` และใช้ได้กับทั้งเครื่องมือ Bash และ PowerShell ส่วน hook ของ Stack Agent เองถามก่อนอยู่แล้วเมื่อ force-push, `reset --hard`, `clean` และลบ branch
- `setup-pre-commit` ติดตั้งแพ็กเกจ รัน `npx husky init` (ซึ่งตั้ง `core.hooksPath`) และเพิ่ม Prettier ผ่าน lint-staged ในโปรเจกต์ที่ใช้ Stack Agent ให้กัน `.stack-agent/` ออกจาก Prettier
- `step-script` อ่าน `.env` และเขียนความลับลงในนั้นและลง GitHub ได้ สคริปต์ที่มันสร้างจะไม่ยอมเขียนไฟล์ที่ git ไม่ได้ ignore และส่ง `gh secret set` กับ `gh variable set` ไปที่ repo เดียวที่ระบุชื่อชัด (`WIZARD_REPO` หรือ repo ที่ `gh` หาเจอ) แล้วพิมพ์ชื่อนั้นให้เห็น
- `scaffold-exercises` และ `migrate-to-shoehorn` ติดตั้งและรันแพ็กเกจ
- `improve-codebase-architecture` เขียนรายงาน HTML แล้วเปิดในเบราว์เซอร์ หน้านั้นโหลดสคริปต์จาก CDN สาธารณะ จึงต้องต่ออินเทอร์เน็ต และดึงโค้ดจากข้างนอกมาตอนเปิดอยู่ skill มีแบบออฟไลน์ที่ไม่มีสคริปต์ด้วย เก็บไฟล์ไว้ในเครื่อง อย่าเอาไปเผยแพร่
- `setup-workflow` เขียนสามไฟล์ใน `.stack-agent/workflow/` และสร้างป้าย triage บน tracker ของคุณได้ก็ต่อเมื่อคุณตอบตกลง
- `triage`, `implement`, `implement-spec`, `to-spec`, `to-tickets`, `wayfinder` เขียนลง tracker ของคุณ ไม่ push และไม่เปิด pull request เว้นแต่คุณสั่ง ข้อความจาก issue และ pull request ถือเป็นข้อมูล `triage` ไม่เปลี่ยนอะไรก่อนคุณยืนยัน และโชว์คำสั่งให้คุณเห็นก่อนรันอะไรที่มาจากรายงาน

## เทียบกับ skill ของ Stack Agent เอง

| ถ้าคุณพิมพ์ | เริ่ม | หมายเหตุ |
| --- | --- | --- |
| รายงานบั๊ก "ช่วยหาและแก้" "ทำไมถึงคืน 500" | `debug` | ของ Stack Agent: ทำ repro ก่อน เก็บเป็นเทสต์ แก้ที่ต้นเหตุ พร้อมหลักฐานจาก `verify` กรณียากหรือช้า มี `LOOPS.md` เป็นรายการวิธีสร้าง repro |
| "แน่ใจว่าใช้ได้" | `verify` | `tdd`, `implement` และ `implement-spec` รัน `verify` ด้วยในโปรเจกต์ที่มี `.stack-agent/verify.json` |
| "สุ่มตรวจ commit ล่าสุด" | `sample-review` (พิมพ์) | `code-review` รีวิว diff ที่คุณระบุ ส่วน `sample-review` สุ่ม commit เพื่อหารูปแบบสำหรับ guard |
| "ฉันแก้เรื่องอะไรซ้ำๆ" | `mine-corrections` (พิมพ์) | `retro` และ `writing-for-agents` เสนอการเปลี่ยนสภาพแวดล้อมและคำสั่งของ agent |

ในโปรเจกต์ที่ใช้ Stack Agent Stop hook ขอหลักฐานที่ตรงกับโค้ดเมื่อโค้ดเปลี่ยน โค้ดของ `prototype` เป็นโค้ดทิ้ง จึงเก็บไว้บน branch ของมัน หรือบอกว่ายังไม่ได้ตรวจ

## ถ้าคุณใช้ mattpocock/skills อยู่แล้ว

อย่าเก็บไว้ทั้งสองชุด ถ้าเคยติดตั้ง plugin นั้นหรือรันตัวติดตั้งของเขา ให้ถอดชุดนั้นออก (หรือถอดสำเนาของ Stack Agent) ไอเดียเดียวกันจะได้ไม่ขึ้นรายการซ้ำ หลายชื่อที่นี่ต่างจากต้นฉบับ (`ask-matt` เป็น `which-skill`, `setup-matt-pocock-skills` เป็น `setup-workflow`, `wait-what` เป็น `re-explain`, `wizard` เป็น `step-script`, `git-guardrails-claude-code` เป็น `git-guardrails`; `grill-me` กับ `grill-with-docs` เป็น `grilling`; `diagnosing-bugs` เป็นส่วนหนึ่งของ `debug`) และค่าตั้งของ tracker อยู่ใน `.stack-agent/workflow/` แทน `docs/agents/`

## ที่มาของ skill เหล่านี้และการเปลี่ยนแปลง

skill เหล่านี้เป็นของเราที่แก้ได้ [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) เก็บสัญญาอนุญาต MIT ของโปรเจกต์ต้นฉบับ และบอกว่าแต่ละตัวถูก *เขียนใหม่* (ข้อความใหม่ด้วยไอเดียของต้นฉบับ) หรือ *แก้* (ข้อความต้นฉบับพร้อมการเปลี่ยน) และทุกการเปลี่ยนที่เกินกว่าถ้อยคำ รุ่นใหม่ของต้นฉบับใช้อ่านเอาไอเดีย แล้วยกมาทีละส่วนด้วยมือ คัดลอกทับไม่ได้ หลังแก้ skill ทุกครั้งรัน `claude plugin validate . --strict`, `npm test` และ `node scripts/skill-scan.mjs` แล้วรันเคส eval ของมันซ้ำ (ดู skill `run-evals`)
