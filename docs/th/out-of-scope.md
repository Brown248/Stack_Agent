# สิ่งที่ไม่ทำ

ไอเดียที่ Stack Agent ตัดสินใจไม่รับ พร้อมเหตุผล `design-notes.md` อธิบายว่าแต่ละส่วนมีไว้ทำไม ส่วนหน้านี้อธิบายว่าทำไมบางอย่างถึงไม่มี จะได้ไม่ต้องถกคำขอเดิมซ้ำ ถ้าคุณ fork Stack Agent ไปแล้วทีมอยากได้ข้อใดข้อหนึ่งก็ทำได้เลย เหตุผลด้านล่างเป็นเหตุผลของ template ที่ต้องใช้ได้กับทุกโปรเจค ไม่ได้เกี่ยวกับโปรเจคของคุณ

ไอเดียจากทอล์กต้นทางที่ไม่ได้ทำ (auto-merge, การคุมเบราว์เซอร์, cloud agent, กฎเฉพาะของ codebase เดียว) อยู่ในหัวข้อ "ที่ตั้งใจไม่ทำ" ของ [design-notes.md](design-notes.md) หน้านี้เก็บไอเดียที่มาจากโปรเจคอื่น แต่ละข้อบอกไอเดีย ที่มา เหตุผล และสิ่งที่ Stack Agent ทำแทน ถ้าจะเปิดข้อใดขึ้นมาใหม่ ให้แสดงว่ามีอะไรเปลี่ยน: ปัญหาที่วัดได้ซึ่งการออกแบบตอนนี้จับไม่ได้ หรือเหตุผลด้านล่างที่ไม่จริงแล้ว

[English](../out-of-scope.md)

## prompt ตั้งต้นที่ฉีดเข้าทุก session

- **ที่มา:** obra/superpowers, `skills/using-superpowers` ที่ SessionStart hook โหลดเข้ามา ("If you think there is even a 1% chance a skill might apply… you ABSOLUTELY MUST invoke")
- **ทำไมไม่ทำ:** บังคับด้วยคำพูดและเสีย token ทุก session แม้ใน session ที่ไม่มี skill ไหนเกี่ยว superpowers เองก็ต้องตัดให้สั้นลง (release notes v6.1.0) กฎของ Stack Agent ต้องยังมีผลแม้ agent จะไม่ทำตามคำพูด
- **ทำอะไรแทน:** hook และ script ที่หยุด agent ได้จริง (Stop hook, hook ของ shell และการแก้ไฟล์, verify, guard) ซึ่งทำงานเฉพาะในโปรเจคที่ติดตั้ง Stack Agent และ description ของ skill ที่บอกว่าใช้เมื่อไร ซึ่งวัดผลด้วย A/B และ eval case

## วิธีพัฒนาแบบเดียวสำหรับทุกโปรเจค

- **ที่มา:** obra/superpowers (brainstorm, วางแผน, worktree, ให้ subagent ทำ, TDD แบบเคร่งที่ลบโค้ดที่เขียนก่อนเทส, จบ branch ด้วย merge หรือ PR)
- **ทำไมไม่ทำ:** template สำหรับทุกโปรเจคเลือกวิธีทำงานแบบเดียวให้ไม่ได้ แต่ละทีมทำ TDD, branch และรีวิวไม่เหมือนกัน และ flow การ merge แบบตายตัวขัดกับการให้คนตัดสินใจเองว่าจะ commit เมื่อไร
- **ทำอะไรแทน:** check ที่ใช้ได้ไม่ว่าจะทำงานแบบไหน: verify กับขั้น against พิสูจน์ว่า check fail บนโค้ดเก่า, guard ไล่ขันกฎทีละขั้น และ Stop hook ขอเทสหรือ check เมื่อโค้ดเปลี่ยนแต่ไม่มีอะไรใหม่ตรวจ

## manifest และ shim สำหรับเครื่องมือ agent อื่น

- **ที่มา:** obra/superpowers (ราว 16 เครื่องมือ), mattpocock/skills (`agents/openai.yaml`, skills.sh)
- **ทำไมไม่ทำ:** สิ่งที่ Stack Agent บังคับส่วนใหญ่อยู่ใน hook ของ Claude Code ถ้า port ไปโดยไม่มี hook ที่เทียบเท่า ก็จะได้ skill ที่ไม่มีอะไรบังคับ แต่ดูเหมือนใช้ได้
- **ทำอะไรแทน:** script ที่ vendor ไว้ใน `.stack-agent/bin/` กับ workflow ของ CI เป็น Node ล้วน รันที่ไหนก็ได้ ส่วน hook กับ skill ใช้ได้เฉพาะ Claude Code

## skill ที่ผูกกับ issue tracker

- **ที่มา:** mattpocock/skills (`triage`, `to-tickets`, `to-spec`, `wayfinder`, `implement-spec`, `setup-matt-pocock-skills`) ซึ่งอ่านเขียน issue ผ่าน `gh` หรือ `glab` และเอกสาร tracker ของแต่ละ repo
- **ทำไมไม่ทำ:** Stack Agent ไม่สมมติว่ามี tracker, host หรือ CLI อื่นนอกจาก git กับ Node
- **ทำอะไรแทน:** spec มาจาก commit message หรือไฟล์ (`sample-review` และ source แบบ `spec` ของ reviewer)

## เครื่องมือที่ต้อง `npm install`

- **ที่มา:** Changesets (การออกรุ่นของ mattpocock/skills), dependency-cruiser (`setup-ts-deep-modules`), harness eval ชื่อ Quorum (obra/superpowers: bun, tmux, container), Playwright (microsoft/playwright)
- **ทำไมไม่ทำ:** repo ปลายทาง vendor script ไว้ใน `.stack-agent/bin/` และ CI รันโดยไม่ต้องติดตั้งอะไร dependency ตัวเดียวก็ทำให้ข้อนี้พังทุกโปรเจค และ Changesets เขียน changelog ได้แค่ภาษาอังกฤษ ขณะที่ Stack Agent มีสองภาษา
- **ทำอะไรแทน:** script Node ESM ที่ไม่มี dependency, กฎ import ของ guard กับ `extends` สำหรับขอบเขตของ module, harness A/B ใน `scripts/ab/` และ `claude plugin eval` สำหรับ eval case โปรเจกต์ที่ใช้ Playwright อยู่แล้วรันเป็น command check ใน `verify.json` ของตัวเองได้

## skill ที่เครื่องมือเขียน แก้ และเก็บเข้าคลังเอง

- **ที่มา:** tigerless-labs/autoharness (MIT): ทุก 50 tool call มี session haiku เบื้องหลังอ่านงานแล้วเสนอ skill สคริปต์ตรวจและเขียนให้ และ skill ที่ไม่มีใครโหลดจะถูกย้ายเข้าโฟลเดอร์เก็บ
- **ทำไมไม่ทำ:** skill ถูกอ่านโดยทุก session ต่อไป skill ที่เขียนโดยไม่มีคนดูจึงเป็นการเปลี่ยนที่ไม่มีใครตรวจ Stack Agent แสดงตารางพร้อมหลักฐานที่ยกข้อความมา แล้วรอ (`reflect`, `mine-corrections`) วงนั้นยังเสียเงินกับ session ลูกทุกรอบ และ README ของเขาเองเรียกค่าตั้งต้นว่า "placeholder รอวัดจริง" ไม่มีอะไรแสดงว่าได้ผล และการเปลี่ยนที่ไม่มีใครวัดคือแบบที่ผลวัดของ repo นี้มักปฏิเสธ มันต้องใช้ Python 3.11 และระบุแค่ Linux กับ macOS ส่วน Stack Agent รันบน Windows ได้ด้วย Node อย่างเดียว
- **ทำอะไรแทน:** หยิบเฉพาะส่วนที่ใช้เดี่ยวๆ ได้: ตัวกรองรหัสลับที่ทำงานก่อน session เก่าไปถึง model และการนับว่า skill ไหนถูกใช้ (`scripts/skill-usage.mjs`) ซึ่งอ่านจาก transcript ที่มีอยู่แล้วแทน hook กับไฟล์นับ และรายงานเท่านั้น ส่วนกฎของเขาที่ให้เขียนบรรทัดเก่าที่ถูกกฎใหม่ขัดนั้นลองแล้วไม่เอา: `reflect` ทำอยู่แล้ว 4 รอบจาก 4 (บันทึกการออกแบบ 29 ต.ค. 2026)

## skill ที่ออกแบบทีม agent ให้โดเมน

- **ที่มา:** revfactory/harness (Apache 2.0): "build a harness for this project" สร้างนิยาม agent, skill และตัวประสานงานตามรูปแบบทีมหกแบบ พร้อม skill ไว้ให้มันวิวัฒนาการ
- **ทำไมไม่ทำ:** Stack Agent ให้กฎ ตัวตรวจ และ skill ชุดเดียวกันกับทุกโปรเจกต์ จุดของ template คือตัวตรวจต้องใช้ได้ไม่ว่า agent จะเป็นอะไร ทีมที่สร้างขึ้นคือคำสั่งใหม่ที่ไม่มีใครตรวจในทุกโปรเจกต์ และผลที่เขาเผยแพร่เป็นการวัดของผู้เขียนเองบน 15 งาน
- **ทำอะไรแทน:** preset ที่มี `.stack-agent/` ของกฎที่โปรเจกต์แก้ได้ agent อ่านอย่างเดียวสามตัว (`reviewer`, `judge`, `finding-verifier`) และ `reflect` / `mine-corrections` สำหรับแก้ skill โดยมีคนอนุมัติ ส่วนการทดสอบ description ของ skill ของเขาถูกหยิบมา (`skill-routing`)

## แพลตฟอร์มฝูง agent หน่วยความจำ และการเชื่อมหลายเครื่อง

- **ที่มา:** ruvnet/ruflo (MIT): agent 98 ตัว เครื่องมือ MCP 314 ตัว ฝูง agent หน่วยความจำแบบ vector agent ข้ามเครื่อง และปลั๊กอิน 35 ตัว
- **ทำไมไม่ทำ:** เป็นอีกผลิตภัณฑ์หนึ่ง ไฟล์คำสั่งของเขาตัวเดียวก็ 72 KB ในทุก session และรายงานตรวจสอบที่อ่านผ่านด้วยการดูว่ามีข้อความอยู่ในไฟล์ Stack Agent เก็บกฎหนักไว้ใน hook และสคริปต์ที่หยุด agent และไม่เพิ่มหน่วยความจำที่คนอ่านไม่ได้
- **ทำอะไรแทน:** ไม่ได้หยิบอะไร hook PreToolUse ของเรามีอยู่แล้วที่ถามก่อนคำสั่ง git ที่ทำลายหรือการแก้กฎของ guard เอง ส่วนเรื่องการใช้เงิน Stack Agent ไม่มี

## ตารางข้ออ้างในทุก skill

- **ที่มา:** addyosmani/agent-skills (MIT): ทุก skill ปิดท้ายด้วยข้ออ้างที่ agent ใช้ข้ามขั้นตอน พร้อมคำโต้แย้งทีละข้อ
- **ทำไมไม่ทำ:** ลองแล้วไม่ช่วย เมื่อได้ skill `verify` กับเหตุผลที่ฟังดีสำหรับการไม่เขียน check Sonnet ทำถูก 17 จาก 20 ครั้งกับ skill ที่ส่งมอบอยู่ และ 17 จาก 20 เมื่อเพิ่มตารางห้าแถว (0 จาก 20 เมื่อไม่มี skill) ไม่มีครั้งที่พลาดข้อไหนใช้ข้ออ้างเลย (บันทึกการออกแบบ หัวข้อ "อ่านอีกเจ็ด repo") เป็นสถานการณ์เดียวกับโมเดลเดียว
- **ทำอะไรแทน:** ใช้ skill ตามที่เป็น และมีเคส `skip-excuses` ไว้สังเกตถ้าเปลี่ยนไป ส่วนชุดคำสั่ง `/spec`, `/plan`, `/build` ของเขาเข้าข้อ "วิธีพัฒนาแบบเดียวสำหรับทุกโปรเจค" ข้างบน

## กราฟความรู้ของโค้ดที่ดัน agent ให้ไปถาม

- **ที่มา:** Graphify-Labs/graphify (Apache-2.0 / MIT): ใช้ tree-sitter สร้างกราฟของ call กับ import มี skill `/graphify` และ hook ที่ดันการเรียกเครื่องมือแนวค้นหาไปทางกราฟ
- **ทำไมไม่ทำ:** ซ้ำกับ `api-map` และ `feature-map` ต้องใช้ Python 3.10 กับ `uv` หรือ `pipx` และการดัน agent ให้เลี่ยงการอ่านโค้ดสวนทางกับสิ่งที่ verify ต้องการ ตัวเลขที่ดีขึ้นที่เขาอ้างเป็นการวัดของผู้ทำเองบน repo เดียว
- **ทำอะไรแทน:** `api-map` และ `feature-map` ที่ fail เมื่อแผนที่ไม่ตรงกับโค้ด ความคิดหนึ่งที่ยืมได้ถ้าแผนที่ที่ร่างให้เกิดปัญหา: ติดป้ายแต่ละบรรทัดว่ามาจากโค้ดตรงๆ หรือเดา

## skill ที่ผลลัพธ์เป็นเรื่องรสนิยม และผลิตภัณฑ์ที่ไม่เกี่ยวกับการตรวจ

- **ที่มา:** blader/humanizer (เขียนข้อความให้อ่านเหมือนคนเขียน; MIT), nextlevelbuilder/ui-ux-pro-max-skill (แคตตาล็อกสไตล์และชุดสีที่ค้นได้; MIT มีรุ่นเสียเงิน), infiniflow/ragflow (เครื่องมือ RAG ที่มีหลาย service และฐานข้อมูล), ComposioHQ/awesome-claude-skills (รายชื่อ skill)
- **ทำไมไม่ทำ:** ไม่มีคำสั่งไหนบอกได้ว่าข้อความที่เขียนใหม่ฟังเหมือนคนหรือหน้าจอดูดี verify, guard และ hook จึงไม่มีอะไรให้ยึด และสิ่งที่เขาอ้างมาจากการทดสอบแบบปกปิดชื่อครั้งเดียวหรือตัวอย่างของผู้ทำเอง RAGFlow เป็นคนละผลิตภัณฑ์ และรายชื่อไม่มีอะไรให้หยิบ
- **ทำอะไรแทน:** ไม่ได้หยิบอะไร preset `frontend-web` ของ Stack Agent ตรวจว่าหน้าโหลดและคำสั่ง e2e ผ่าน และบอกตรงๆ แทนการตัดสินว่าสวยหรือไม่

## แก้จุดที่ผิดกฎเดิมใน sample backend

- **ที่มา:** ใครก็ตามที่อ่าน `examples/sample-backend/src/modules/reports/controller.js`
- **ทำไมไม่ทำ:** การละเมิด `module-boundary` ในไฟล์นั้นคือ baseline ที่ตัวอย่าง ratchet และเทสใช้อยู่
- **ทำอะไรแทน:** เก็บไว้ใน `.stack-agent/guard-baseline.json` และการละเมิดใหม่ยัง fail เหมือนเดิม
