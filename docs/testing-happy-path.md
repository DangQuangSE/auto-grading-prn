# Happy-Path Test Flows (Demo Prep)

Mục tiêu: xác nhận toàn bộ chuỗi nghiệp vụ chính chạy được end-to-end trước khi demo —
đăng ký/đăng nhập → tạo subject/assignment/rubric → sinh viên nộp bài → extraction job →
AI grading job → publish điểm → notification. Đây là **happy case only** (input hợp lệ,
không test lỗi/permission/edge case). Test lỗi sẽ là tài liệu riêng sau.

Tất cả endpoint đi qua Gateway (`http://localhost:5500`), trừ khi ghi chú khác.

---

## 1. Chuẩn bị môi trường

```bash
docker compose up -d --build
docker compose ps   # tất cả service phải "healthy"
```

Cổng đã map ra host:

| Service | REST Port | gRPC Port | Swagger | Hangfire |
| --- | --- | --- | --- | --- |
| Gateway | 5500 | — | `/swagger` | - |
| Identity | 5001 | — | `/swagger` | - |
| Catalog | 5002 | 5012 | `/swagger` | `/hangfire` |
| Submission | 5003 | — | `/swagger` | `/hangfire` |
| Grading | 5004 | — | `/swagger` | `/hangfire` |
| Notification | 5005 | — | `/swagger` | - |
| user-web | 5173 | — | - | - |
| admin-web | 5174 | — | - | - |

**Lưu ý:** Catalog gRPC port (5012) dùng cho internal Grading↔Catalog calls (HTTP/2 h2c), không expose qua Gateway.

Mở sẵn 2 tab Hangfire (`localhost:5003/hangfire`, `localhost:5004/hangfire`) trong lúc demo
để chỉ trực quan job `ExtractionJob` / `AiGradingJob` chạy async — rất ấn tượng khi demo.

### Tài khoản test có sẵn (seed sẵn, không cần đăng ký)

Được seed tự động khi `Seed:TestAccounts=true` (đã bật trong `docker-compose.yml`), mật khẩu
chung là `Test@12345`:

| Email | Role |
| --- | --- |
| `testlecturer1@fpt.edu.vn` | Lecturer |
| `teststudent1@fpt.edu.vn` | Student |
| `testadmin1@fpt.edu.vn` | Admin |

(còn `teststudent2..10`, `testlecturer2..4` nếu cần nhiều actor cùng lúc)

### ⚠️ Gotcha cần nhớ

- **Double prefix qua Gateway**: route nội bộ của Submission và Notification service tự đặt
  tên group trùng với prefix Gateway (`/submissions`, `/notifications`), nên khi gọi *qua
  Gateway* phải gọi `/submissions/submissions/...` và `/notifications/notifications`
  (Catalog/Grading không bị vấn đề này: group là `/subjects`, `/assignments`, `/rubrics`,
  `/grades` — khác tên prefix `/catalog`, `/grading`). Ví dụ đúng:
  `POST http://localhost:5500/submissions/submissions/upload`.
- **Google login yêu cầu email `.edu`**; `/auth/register` + `/auth/login` (email/password)
  thì không giới hạn domain — dùng cách này cho test.
- **Subject mới tạo mặc định `RegistrationStatus = Closed`** — không ảnh hưởng việc nộp bài
  qua API (upload không kiểm tra enrollment), nhưng **có** ảnh hưởng tới việc lecturer xem bài
  (xem gotcha tiếp theo).
- **Lecturer chỉ thấy submission của sinh viên trong lớp mình dạy** — `GET
  /submissions/submissions` (list), `GET /submissions/submissions/{id}`, và `POST
  /submissions/submissions/{id}/retry` scope theo enrollment: lecturer phải có ít nhất 1
  `Class` (subject-scoped, `lecturerId` = chính họ) cho subject của assignment đó, và sinh
  viên phải **enroll vào lớp đó** — nếu không, lecturer nhận về danh sách rỗng / `403
  Forbidden`, kể cả khi sinh viên đã nộp bài thành công. Một lecturer có thể dạy nhiều class
  của cùng 1 subject — được gộp chung (union), không cần chọn đúng 1 mã lớp cụ thể. `admin`
  không bị giới hạn này (luôn thấy tất cả). Xem mục 2.11 để test riêng flow này.
- AI grading gọi LLM thật (AI provider) — có thể mất 10–60s, đừng poll quá gấp.

---

## 2. Happy Case — API/Postman (nhanh, dùng để verify backend)

Dùng `curl` + `jq` (Git Bash). Có thể copy nguyên khối chạy tuần tự.

```bash
BASE=http://localhost:5500

# --- 2.1 Login (dùng tài khoản seed sẵn) ---
LECTURER_LOGIN=$(curl -s -X POST $BASE/identity/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testlecturer1@fpt.edu.vn","password":"Test@12345"}')
LECTURER_TOKEN=$(echo $LECTURER_LOGIN | jq -r .token)
LECTURER_ID=$(echo $LECTURER_LOGIN | jq -r .userId)

STUDENT_LOGIN=$(curl -s -X POST $BASE/identity/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teststudent1@fpt.edu.vn","password":"Test@12345"}')
STUDENT_TOKEN=$(echo $STUDENT_LOGIN | jq -r .token)
STUDENT_ID=$(echo $STUDENT_LOGIN | jq -r .userId)

ADMIN_TOKEN=$(curl -s -X POST $BASE/identity/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testadmin1@fpt.edu.vn","password":"Test@12345"}' | jq -r .token)

echo "lecturer id: $LECTURER_ID"
echo "student id: $STUDENT_ID"
```

**Kỳ vọng**: cả 2 request trả `200 OK`, `token` không rỗng, `role` đúng (`lecturer`/`student`).

```bash
# --- 2.2 Lecturer: tạo Subject ---
SUBJECT=$(curl -s -X POST $BASE/catalog/subjects \
  -H "Authorization: Bearer $LECTURER_TOKEN" -H "Content-Type: application/json" \
  -d '{"code":"SWD392","name":"Software Architecture and Design"}')
SUBJECT_ID=$(echo $SUBJECT | jq -r .id)
```

**Kỳ vọng**: `201 Created`, `registrationStatus: "Closed"`, có `id`.

```bash
# --- 2.3 Lecturer: tạo Assignment ---
ASSIGNMENT=$(curl -s -X POST $BASE/catalog/assignments \
  -H "Authorization: Bearer $LECTURER_TOKEN" -H "Content-Type: application/json" \
  -d "{\"subjectId\":\"$SUBJECT_ID\",\"title\":\"Assignment 1 - Architecture Report\",\"description\":\"Nộp báo cáo + diagram\",\"maxAttempts\":3}")
ASSIGNMENT_ID=$(echo $ASSIGNMENT | jq -r .id)
```

**Kỳ vọng**: `201 Created`, `maxAttempts: 3`.

```bash
# --- 2.4 Lecturer: upload Rubric (.docx) ---
# Xem format chuẩn tại docs/rubric-docx-format.md — cần file .docx thật, không phải placeholder
RUBRIC=$(curl -s -X POST $BASE/catalog/rubrics/upload \
  -H "Authorization: Bearer $LECTURER_TOKEN" \
  -F "SubjectId=$SUBJECT_ID" \
  -F "AssignmentId=$ASSIGNMENT_ID" \
  -F "Name=Rubric v1" \
  -F "Scope=Lecturer" \
  -F "File=@/path/to/rubric.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document")
RUBRIC_ID=$(echo $RUBRIC | jq -r .id)
echo "status: $(echo $RUBRIC | jq -r .status)"   # "Parsing"
```

**Kỳ vọng**: `201 Created`, `status: "Parsing"`. Job `RubricParsingJob` chạy async (xem
`localhost:5002/hangfire`) → status chuyển `Draft`. Poll cho tới khi Draft:

```bash
until [ "$(curl -s $BASE/catalog/rubrics?assignmentId=$ASSIGNMENT_ID -H "Authorization: Bearer $LECTURER_TOKEN" | jq -r '.[0].status')" = "Draft" ]; do sleep 2; done
```

```bash
# --- 2.5 Lecturer: confirm Rubric ---
curl -s -X POST $BASE/catalog/rubrics/$RUBRIC_ID/confirm \
  -H "Authorization: Bearer $LECTURER_TOKEN" | jq -r .status   # "Confirmed"
```

**Kỳ vọng**: `200 OK`, `status: "Confirmed"` (bắt buộc — Grading job chỉ chạy tốt khi rubric
đã confirmed và có criteria).

```bash
# --- 2.6 Student: upload Submission (.docx + .drawio) ---
# Chú ý double-prefix /submissions/submissions/upload — xem mục Gotcha ở trên
SUBMISSION=$(curl -s -X POST $BASE/submissions/submissions/upload \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -F "AssignmentId=$ASSIGNMENT_ID" \
  -F "ReportFile=@/path/to/report.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
  -F "DiagramFile=@/path/to/diagram.drawio;type=application/octet-stream")
SUBMISSION_ID=$(echo $SUBMISSION | jq -r .id)
echo "state: $(echo $SUBMISSION | jq -r .state)"   # "Uploading" hoặc "Uploaded"
```

**Kỳ vọng**: `201 Created`, `attemptNumber: 1`.

```bash
# --- 2.7 Poll trạng thái Submission cho tới khi extraction xong ---
until [ "$(curl -s $BASE/submissions/submissions/$SUBMISSION_ID -H "Authorization: Bearer $STUDENT_TOKEN" | jq -r .state)" = "Extracted" ]; do
  sleep 2
done
echo "extracted OK"
```

**Kỳ vọng**: `state` đi qua `Uploaded → Extracting → Extracted` (xem `localhost:5003/hangfire`
job `ExtractionJob`), có `artifacts[]` không rỗng.

```bash
# --- 2.8 Poll AI Grading run (Grading service tự enqueue khi Extracted) ---
until [ "$(curl -s $BASE/grading/grades/$SUBMISSION_ID/runs -H "Authorization: Bearer $LECTURER_TOKEN" | jq -r '.[0].status')" = "Completed" ]; do
  sleep 5
done
RUN_ID=$(curl -s $BASE/grading/grades/$SUBMISSION_ID/runs -H "Authorization: Bearer $LECTURER_TOKEN" | jq -r '.[0].id')
curl -s $BASE/grading/grades/$SUBMISSION_ID/runs -H "Authorization: Bearer $LECTURER_TOKEN" | jq '.[0].scores'
```

**Kỳ vọng**: `status: "Completed"`, `scores[]` có 1 phần tử mỗi criterion trong rubric, mỗi
phần tử có `suggestedScore` hợp lệ (0 ≤ score ≤ maxScore của criterion đó). Job này gọi LLM
thật nên có thể mất 10–60s — theo dõi tại `localhost:5004/hangfire`.

```bash
# --- 2.9 Lecturer: publish điểm cuối cùng ---
curl -s -X POST $BASE/grading/grades/$SUBMISSION_ID/publish \
  -H "Authorization: Bearer $LECTURER_TOKEN" -H "Content-Type: application/json" \
  -d "{\"gradingRunId\":\"$RUN_ID\",\"finalScore\":8.5,\"notes\":\"Good job\"}" | jq .
```

**Kỳ vọng**: `201 Created`, trả về `FinalGrade` với `finalScore: 8.5`. Nếu gọi lần 2 phải trả
`409 Conflict` (không phải happy case, chỉ lưu ý).

```bash
# --- 2.10 Student: kiểm tra Notification vừa được publish ---
curl -s "$BASE/notifications/notifications?userId=$STUDENT_ID" \
  -H "Authorization: Bearer $STUDENT_TOKEN" | jq '.[0]'
```

**Kỳ vọng**: `200 OK`, phần tử đầu tiên (mới nhất) có nội dung liên quan "grade published",
`isRead: false`.

```bash
# --- 2.11 Lecturer: xem submissions của học sinh TRONG LỚP MÌNH DẠY ---
# Bước bắt buộc: mở registration, tạo Class (subject-scoped, lecturerId = chính lecturer),
# rồi cho student enroll — enrollment chỉ chấp nhận khi subject đang "Open"
curl -s -X PATCH $BASE/catalog/subjects/$SUBJECT_ID/registration \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"Open"}' > /dev/null

CLASS=$(curl -s -X POST $BASE/catalog/classes/subject-scoped \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"SE1234\",\"lecturerId\":\"$LECTURER_ID\",\"subjectId\":\"$SUBJECT_ID\"}")
CLASS_ID=$(echo $CLASS | jq -r .id)

curl -s -X PUT "$BASE/catalog/enrollments/me/$SUBJECT_ID" \
  -H "Authorization: Bearer $STUDENT_TOKEN" -H "Content-Type: application/json" \
  -d "{\"classId\":\"$CLASS_ID\"}"

# Giờ lecturer thấy submission của teststudent1
curl -s "$BASE/submissions/submissions?assignmentId=$ASSIGNMENT_ID" \
  -H "Authorization: Bearer $LECTURER_TOKEN" | jq 'length'   # >= 1

# Lecturer KHÁC (không dạy lớp nào của subject này) phải thấy rỗng
LECTURER2_TOKEN=$(curl -s -X POST $BASE/identity/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testlecturer2@fpt.edu.vn","password":"Test@12345"}' | jq -r .token)
curl -s "$BASE/submissions/submissions?assignmentId=$ASSIGNMENT_ID" \
  -H "Authorization: Bearer $LECTURER2_TOKEN" | jq 'length'   # phải là 0
```

`ADMIN_TOKEN`/`LECTURER_ID` lấy tương tự bước 2.1 (login `testadmin1@fpt.edu.vn`, và
`LECTURER_ID` là `userId` trả về khi lecturer login). **Kỳ vọng**: `testlecturer1` (dạy lớp
SE1234) thấy đúng 1 submission; `testlecturer2` (không dạy lớp nào ở subject này) thấy mảng
rỗng dù cùng gọi 1 endpoint với cùng `assignmentId` — xác nhận scope theo lớp hoạt động đúng.
`GET /submissions/submissions/{id}` và `POST /submissions/submissions/{id}/retry` cũng áp
dụng cùng quy tắc.

Nếu tất cả bước trên trả đúng status code + field như mô tả → **happy path backend PASS**.

---

## 3. Happy Case — UI Demo Script, từng màn hình (dùng khi trình bày trực tiếp)

`user-web` (5173) **chỉ có 3 màn hình, tất cả cho student**: **Submit**, **Result**,
**Profile**. Toàn bộ nghiệp vụ Dashboard/Subjects/Assignments/Rubric/Classes/Roster/Grades/
**Review** nằm ở `admin-web` (5174) — lecturer đăng nhập chung app này với admin, chỉ riêng
menu **Classes** bị ẩn/chặn nếu không phải role `admin`. **Không có màn "Audit Events" nào
trong UI hiện tại** — `GET /audit-events` chỉ gọi được qua API/Swagger, chưa có trang admin-web
tương ứng (đã sửa lại so với bản trước, xin đính chính).

Bản đồ toàn bộ màn hình:

| # | Màn hình | App | URL | Role thấy trong nav |
| --- | --- | --- | --- | --- |
| 1 | Login | cả 2 app | `/login` | tất cả |
| 2 | Dashboard | admin-web | `/dashboard` | lecturer, admin |
| 3 | Subjects | admin-web | `/subjects` | lecturer, admin |
| 4 | Classes | admin-web | `/classes` | **chỉ admin** |
| 5 | Assignments | admin-web | `/assignments` | lecturer, admin |
| 6 | Rubric | admin-web | `/rubrics` | lecturer, admin |
| 7 | Roster | admin-web | `/roster` | lecturer, admin (**scoped** với lecturer) |
| 8 | Bulk import | admin-web | `/roster/import` | lecturer, admin |
| 9 | Grades (export) | admin-web | `/grades` | lecturer, admin (**scoped** với lecturer) |
| 10 | Review (chấm & publish) | admin-web | `/review`, `/review/:id` | lecturer, admin (**scoped** với lecturer) |
| 11 | Profile (enroll) | user-web | `/profile` | student |
| 12 | Submit | user-web | `/submit` | student |
| 13 | Result (realtime) | user-web | `/result`, `/result/:id` | student |

"Scoped với lecturer" = tính năng vừa thêm: lecturer chỉ thấy dữ liệu của sinh viên trong lớp
mình dạy; admin luôn thấy tất cả. Test các màn này với **2 lecturer khác nhau** để xác nhận.

### 3.1 Admin — Dashboard (`admin-web`, `/dashboard`)

1. Đăng nhập `testadmin1@fpt.edu.vn` / `Test@12345`.
2. Xem 3 ô số liệu **Ready to review / Processing / Needs action** + bảng "recent submissions".

**Kỳ vọng**: 3 ô số liệu khớp với dữ liệu thật (0/0/0 nếu DB mới); bảng trống với thông báo
"No submissions yet" nếu chưa có submission nào.

### 3.2 Admin — Subjects (`/subjects`)

1. Tạo subject mới: `code` (vd `SWD392`), `name`.
2. Mở **Registration** trên subject vừa tạo → set `Open` (bắt buộc, để bước 3.6 — student
   enroll — dùng được).

**Kỳ vọng**: subject xuất hiện ngay trong danh sách; registration status đổi `Closed → Open`.

### 3.3 Admin — Classes (`/classes`, **chỉ admin thấy menu này**)

1. Tạo class mới: `name` (vd `SE1234`), chọn `Subject` = vừa tạo, chọn `Lecturer` =
   `testlecturer1`. **Bước này bắt buộc** — thiếu nó, lecturer sẽ không thấy gì ở Roster/
   Grades/Review (3.9/3.11/3.12) dù sinh viên đã nộp bài.
2. (tuỳ chọn) Thử **Edit** một class, đổi lecturer/subject — quan sát validate: không thể đổi
   subject của class đã có enrollment (trả lỗi `409`).
3. (tuỳ chọn) Mục **Correct student enrollment** phía dưới — nhập Student UUID của
   `teststudent1` (lấy từ bước 2.1 script API, hoặc Swagger login) → xem danh sách enrollment
   hiện có → chọn lớp thay thế → Save (dùng khi admin cần sửa nhầm lẫn enrollment của SV).

**Kỳ vọng**: class hiển thị đúng tên lecturer + subject; đổi subject của class có SV đã
enroll bị chặn với thông báo lỗi rõ ràng, không phải lỗi trắng trang.

### 3.4 Lecturer — Assignments (`/assignments`)

1. Đăng xuất, đăng nhập `testlecturer1@fpt.edu.vn` / `Test@12345`.
2. Chọn subject vừa tạo → tạo assignment (title, due date, max attempts).

**Kỳ vọng**: assignment xuất hiện ngay trong danh sách của đúng subject.

### 3.5 Lecturer — Rubric (`/rubrics`)

1. **Upload Rubric** → chọn file `.docx` theo format ở `docs/rubric-docx-format.md`, gắn
   đúng assignment vừa tạo → chờ status `Parsing → Draft` (tự poll hoặc F5).
2. Xem **criteria** được parse đúng tên/điểm tối đa như trong file → bấm **Confirm**.

**Kỳ vọng**: status đổi `Parsing → Draft → Confirmed`; sau khi Confirmed, rubric này sẽ hiện
được cho cả sinh viên xem (đúng tính năng "student rubric viewing" — rubric `Draft` thì không
ai khác ngoài lecturer sở hữu/admin xem được, đây là fix vừa thêm).

### 3.6 Student — Profile / đăng ký lớp (`user-web`, `/profile`)

1. Đăng xuất `admin-web`, mở `user-web` (http://localhost:5173), đăng nhập
   `teststudent1@fpt.edu.vn` / `Test@12345`.
2. Vào **Profile** → mục "Choose or change class" → chọn đúng subject vừa mở đăng ký → chọn
   đúng class do `testlecturer1` dạy (tạo ở 3.3) → **Save enrollment**. **Bước này bắt buộc**
   cùng lý do ở 3.3.

**Kỳ vọng**: bảng "Subjects and classes" phía trên cập nhật ngay dòng mới; thử enroll lại
subject đó với class khác → không lỗi (upsert); thử khi registration đang `Closed` → phải
báo lỗi rõ ràng (409/"registration closed"), không phải lỗi mơ hồ.

### 3.7 Student — Submit (`/submit`)

1. Chọn đúng subject/assignment vừa tạo → kéo-thả `report.docx` (+ `diagram.drawio` tuỳ
   chọn) → **Submit**.
2. Quan sát chỉ báo "Attempts used: x / maxAttempts" trước khi bấm submit.

**Kỳ vọng**: validate đúng extension (`.docx`/`.drawio`), từ chối file sai định dạng; sau
submit tự chuyển sang màn **Result**; nộp vượt `maxAttempts` phải báo lỗi rõ (409), nút Submit
bị disable khi `limitReached`.

### 3.8 Student — Result, theo dõi realtime (`/result/:id`)

1. Theo dõi thanh tiến trình: `Uploaded → Extracting → AiGrading → Completed` — cập nhật
   **tự động qua SignalR** (`/notifications/hub`), không cần F5. Hangfire dashboard
   (`:5003/hangfire`, `:5004/hangfire`) chạy song song để đối chiếu.
2. Sau khi `Completed`, xem bảng **per-criterion score** (AI suggested) + tổng điểm.
3. (tuỳ chọn, test nhánh lỗi) Nếu rơi vào `ExtractionFailed`/`AiGradingFailed`, nút **"Thử
   chấm lại"** gọi `POST /submissions/submissions/{id}/retry` — bấm và xem trạng thái quay về
   `Uploaded` rồi chạy lại.
4. Dropdown phía trên cho phép chọn lại giữa nhiều submission đã nộp (nếu có nhiều attempt).

**Kỳ vọng**: progress bar không cần thao tác thủ công vẫn tự chạy tới `Completed`; điểm AI
suggested hiển thị đúng theo rubric criteria; trước khi lecturer publish, dòng "AI suggested —
pending lecturer review" hiển thị thay vì điểm chính thức.

### 3.9 Lecturer — Roster / danh sách sinh viên (`admin-web`, `/roster`) — **scoped**

1. Quay lại `admin-web`, đăng nhập lại `testlecturer1@fpt.edu.vn`.
2. Vào **Roster** → lọc theo email/MSSV/lớp.
3. **Test scope**: đăng nhập bằng `testlecturer2@fpt.edu.vn` (không dạy lớp nào ở subject
   này, và chưa từng chấm bài `teststudent1`) → mở lại Roster.

**Kỳ vọng**: `testlecturer1` thấy `teststudent1` (vì dạy lớp SV đó enroll, hoặc đã từng chấm
bài SV đó); `testlecturer2` **không thấy** `teststudent1` trong danh sách — đúng fix vừa
thêm (roster giờ chỉ hiện SV mà lecturer có quan hệ lớp/chấm bài thật, không phải toàn bộ hệ
thống). Đăng nhập `testadmin1` → phải thấy toàn bộ, không bị lọc.

### 3.10 Admin — Bulk import roster (`/roster/import`, link "Bulk import" trong Roster)

1. Chuẩn bị file `.xlsx`/`.xls`/`.csv` có cột `Email`, `StudentCode`, `ClassName` (tên cột
   không phân biệt hoa/thường, thứ tự tuỳ ý).
2. Chọn file → xem preview vài dòng đầu → **Upload**.
3. Xem báo cáo: tổng số dòng / updated / skipped, lọc theo trạng thái.

**Kỳ vọng**: dòng có email chưa đăng ký hoặc tên lớp không tồn tại → `skipped` kèm lý do rõ
ràng ("email not registered", "unknown class"); dòng hợp lệ → `updated`, phản ánh ngay trong
Roster (3.9).

### 3.11 Lecturer — Grades, bảng điểm & export Excel (`/grades`) — **scoped**

1. Đăng nhập lại `testlecturer1` → **Grades** → chọn subject/assignment vừa tạo.
2. Lọc theo MSSV/lớp → bấm **Export to Excel** → kiểm tra file tải về đúng cột Student
   Name/MSSV/Class/Final Score.
3. **Test scope** như 3.9: `testlecturer2` mở cùng assignment → bảng phải trống ("No
   submissions for this assignment"), dù `testlecturer1` thấy dữ liệu bình thường.

**Kỳ vọng**: Final Score hiển thị "Not graded" trước khi lecturer publish, hiện số sau khi
publish (3.12); export Excel chỉ chứa đúng những dòng đang hiển thị sau filter.

### 3.12 Lecturer — Review, chấm & publish điểm (`/review`, `/review/:id`) — **scoped**

1. **Review** → chọn Subject → chọn Assignment → bảng submissions hiện ra (chỉ SV lớp mình
   dạy, như 3.9/3.11).
2. Bấm vào submission của `teststudent1` → xem **AI Grading Run** (per-criterion suggested
   score, evidence, comment).
3. Sửa/giữ nguyên điểm từng criterion → **Save** → **Publish**.
4. (tuỳ chọn) Nhập "assignment description / mã đề" → **Regrade** để chạy lại AI grading job.
5. **Test scope**: `testlecturer2` mở Review với cùng assignment → danh sách phải **rỗng**,
   không thể bấm vào submission của `teststudent1` kể cả gõ thẳng URL `/review/{submissionId}`
   (phải trả `403`, không phải hiện được nội dung).

**Kỳ vọng**: `testlecturer1` publish thành công → student (3.8) thấy điểm chính thức ngay,
Grades (3.11) cập nhật Final Score; `testlecturer2` bị chặn hoàn toàn ở mọi thao tác trên
submission này (xem/chấm/publish/regrade) — đúng fix Grading service vừa thêm.

### 3.13 Admin — Review & Grades, đối chiếu không bị scope (`admin-web`)

1. Đăng nhập `testadmin1` → mở **Review** và **Grades** với cùng assignment.

**Kỳ vọng**: admin thấy **tất cả** submissions bất kể lớp/lecturer nào — khác với lecturer ở
3.9/3.11/3.12, xác nhận scope chỉ áp dụng cho role `lecturer`, không áp cho `admin`.

### 3.14 (tuỳ chọn) Login page — điều hướng theo role

Đăng nhập cùng 1 tài khoản `testlecturer1` lần lượt ở `user-web` và `admin-web`: `user-web`
vẫn cho vào (không chặn role), nhưng lecturer không có menu nào phù hợp ở đó (chỉ thấy
Submit/Result/Profile, vốn dành cho student) — nên dùng `admin-web` cho lecturer là chính xác,
đúng như bản đồ màn hình ở đầu mục 3.

---

## 4. Checklist tổng hợp — theo từng màn hình (chạy trước demo 1 lần)

- [ ] `docker compose ps` — toàn bộ container `healthy`
- [ ] Login lecturer/student/admin bằng tài khoản seed, ở đúng app (`admin-web` cho
      lecturer/admin, `user-web` cho student) — nhận JWT hợp lệ (3.14)
- [ ] Dashboard hiện đúng số liệu, không trắng trang khi chưa có dữ liệu (3.1)
- [ ] Subjects: tạo + mở Registration `Open` (3.2)
- [ ] Classes: tạo class gắn đúng lecturer + subject; sửa subject của class có enrollment bị
      chặn đúng lỗi (3.3)
- [ ] Assignments: tạo mới (3.4)
- [ ] Rubric: upload → `Parsing → Draft` → xem criteria đúng → Confirm (3.5)
- [ ] Profile: student enroll đúng subject + đúng class của lecturer đó (3.6) — **bắt buộc**
      trước khi test scope ở Roster/Grades/Review
- [ ] Submit: upload đúng extension, chặn khi vượt `maxAttempts` (3.7)
- [ ] Result: progress bar tự chạy `Uploaded → Extracting → AiGrading → Completed` qua
      realtime, không cần F5; Hangfire (`:5003`, `:5004/hangfire`) không có job `Failed` (3.8)
- [ ] Roster: lecturer dạy lớp đó thấy đúng SV; lecturer khác thấy rỗng; admin thấy tất cả (3.9)
- [ ] Bulk import: file hợp lệ → `updated`, phản ánh lại đúng ở Roster (3.10)
- [ ] Grades: bảng điểm đúng scope theo lecturer, export Excel đúng dữ liệu đang lọc (3.11)
- [ ] Review: publish thành công → student thấy điểm ngay; lecturer khác bị chặn hoàn toàn kể
      cả gõ thẳng URL submission (403) (3.12)
- [ ] Admin mở lại Review/Grades — thấy tất cả, không bị scope như lecturer (3.13)

Nếu một bước fail, dừng lại debug trước khi demo — đừng để lộ lỗi async job giữa buổi trình
bày (đặc biệt `AiGradingJob`, phụ thuộc AI API còn sống). Lưu ý: hiện chưa có
màn hình "Audit Events" trong UI (chỉ gọi được qua `GET /notifications/audit-events` bằng
API/Swagger, admin-only), nên không đưa vào checklist demo UI.
