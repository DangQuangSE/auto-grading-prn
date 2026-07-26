# RabbitMQ trong AutoGrading — giải thích để bảo vệ đồ án

Tài liệu này giải thích RabbitMQ được dùng như thế nào trong hệ thống, có bằng chứng code
(file:line) cho mọi khẳng định, và chuẩn bị sẵn câu hỏi/trả lời cho phần vấn đáp.

---

## 1. Tóm tắt 1 phút

- Có **5 microservice**: Identity, Catalog, Submission, Grading, Notification.
- Cả 5 đều kết nối tới **1 RabbitMQ broker duy nhất**, dùng chung **1 exchange** tên
  `autograding.events` (loại `topic`).
- Mỗi service tự khai báo **queue riêng của mình** để nhận đúng những event nó cần — không
  service nào đọc nhầm queue của service khác.
- Toàn bộ logic RabbitMQ được viết **1 lần duy nhất** trong thư viện dùng chung
  `AutoGrading.Common`, các service chỉ gọi qua interface `IEventBus`, không đụng trực tiếp
  vào thư viện `RabbitMQ.Client`.
- Mục đích: khi 1 service làm xong việc của nó (vd Submission lưu file xong), nó **báo lại**
  cho các service khác bằng cách phát ra 1 "event" — chứ không gọi trực tiếp API của service
  kia. Cách này gọi là **event-driven / pub-sub**, giúp các service **không phụ thuộc cứng**
  vào nhau (Submission không cần biết Identity có đang sống hay không).

---

## 2. Khái niệm RabbitMQ cốt lõi — map thẳng vào code

| Khái niệm | Định nghĩa | Trong code dự án |
|---|---|---|
| **Broker** | Server RabbitMQ, nơi lưu exchange/queue/message | container `rabbitmq` trong `docker-compose.yml:19-35` |
| **Connection** | Kết nối TCP dài hạn từ 1 service tới broker | `factory.CreateConnection()` — `RabbitMqEventBus.cs:45`, mở **1 lần** lúc service khởi động, sống suốt vòng đời process |
| **Channel** | "Kênh ảo" trong 1 connection, dùng để gửi lệnh (publish/declare/consume) | `_connection.CreateModel()` — `RabbitMqEventBus.cs:55`, **1 channel dùng chung** cho publish lẫn consume |
| **Exchange** | Nơi nhận message, quyết định route đi đâu dựa theo routing key | `_channel.ExchangeDeclare(_options.Exchange, ExchangeType.Topic, durable: true)` — `RabbitMqEventBus.cs:56`. **1 exchange duy nhất** tên `autograding.events` cho toàn hệ thống |
| **Routing key** | Chuỗi dùng để exchange biết route message tới queue nào | = **tên class C# của event** (`typeof(TEvent).Name`, tự sinh qua reflection, không hardcode) — `RabbitMqEventBus.cs:62,78` |
| **Queue** | Hàng đợi chứa message chờ được xử lý | mỗi service tự tạo, đặt tên `{ServiceName}.{EventName}` (vd `identity.SubmissionUploaded`) — `RabbitMqEventBus.cs:79-81` |
| **Binding** | Dây nối giữa exchange và queue theo routing key | `_channel.QueueBind(queueName, _options.Exchange, eventName)` — `RabbitMqEventBus.cs:82` |
| **Producer** | Bên gửi message vào exchange | bất kỳ chỗ nào gọi `eventBus.PublishAsync(...)` |
| **Consumer** | Bên đăng ký lắng nghe 1 queue | `AsyncEventingBasicConsumer` + `_channel.BasicConsume(...)` — `RabbitMqEventBus.cs:91,123` |
| **Ack/Nack** | Consumer báo cho broker "xử lý xong, xoá message" | `autoAck: false` + `_channel.BasicAck(ea.DeliveryTag, false)` gọi **thủ công sau khi** handler chạy xong — `RabbitMqEventBus.cs:120,123` |
| **Persistent message** | Message được ghi xuống đĩa, sống sót qua restart broker | `properties.Persistent = true` — `RabbitMqEventBus.cs:66` |

**Vì sao dùng exchange loại `topic`?** Vì `topic` hỗ trợ pattern matching (`*`, `#`) trên routing
key, linh hoạt hơn `direct`. Thực tế dự án hiện chỉ khớp chính xác tên event (chưa dùng wildcard),
nhưng chọn `topic` để dễ mở rộng sau này (vd 1 service muốn nghe "mọi event liên quan Submission"
bằng pattern `Submission*`).

---

## 3. Config — nằm ở đâu, giá trị gì

Class cấu hình: `be/src/BuildingBlocks/AutoGrading.Common/Messaging/RabbitMqOptions.cs`

```csharp
public sealed class RabbitMqOptions
{
    public const string SectionName = "RabbitMq";
    public string HostName { get; set; } = "localhost";
    public int Port { get; set; } = 5672;
    public string UserName { get; set; } = "guest";
    public string Password { get; set; } = "guest";
    public string Exchange { get; set; } = "autograding.events";
    public string ServiceName { get; set; } = "service"; // prefix tên queue
}
```

Giá trị mặc định nằm trong `appsettings.json` của từng service (vd
`Identity/appsettings.json`), nhưng khi chạy qua Docker Compose thì bị **override bằng biến
môi trường** (naming convention `Section__Key` của .NET Configuration) trong
`docker-compose.yml`:

| Service | `RabbitMq__HostName` | `RabbitMq__ServiceName` |
|---|---|---|
| identity-api | `rabbitmq` (tên container) | `identity` |
| catalog-api | `rabbitmq` | `catalog` |
| submission-api | `rabbitmq` | `submission` |
| grading-api | `rabbitmq` | `grading` |
| notification-api | `rabbitmq` | `notification` |

Tất cả 5 service dùng chung `RabbitMq__Exchange: autograding.events` — đây là điểm bắt buộc
phải giống nhau ở mọi service để chúng thấy được message của nhau.

**Đăng ký DI** — 1 dòng gọi ở `Program.cs` của mỗi service:
```csharp
// be/src/BuildingBlocks/AutoGrading.Common/Extensions/ServiceCollectionExtensions.cs:15-21
public static IServiceCollection AddEventBus(this IServiceCollection services, IConfiguration configuration)
{
    services.Configure<RabbitMqOptions>(configuration.GetSection(RabbitMqOptions.SectionName));
    services.AddSingleton<IEventBus, RabbitMqEventBus>();
    return services;
}
```
Gọi từ vd `Identity/Program.cs:27`: `builder.Services.AddEventBus(builder.Configuration);`

**Vì sao Singleton?** Vì connection/channel RabbitMQ tốn kém để mở, cần sống suốt vòng đời
app — không thể tạo mới mỗi request (khác với DbContext là Scoped).

---

## 4. Kiến trúc: interface trừu tượng + 1 implementation

```csharp
// be/src/BuildingBlocks/AutoGrading.Common/Messaging/IEventBus.cs
public interface IEventBus
{
    Task PublishAsync<TEvent>(TEvent @event, CancellationToken ct = default) where TEvent : IntegrationEvent;
    void Subscribe<TEvent, THandler>() where TEvent : IntegrationEvent where THandler : IIntegrationEventHandler<TEvent>;
}
public interface IIntegrationEventHandler<in TEvent> where TEvent : IntegrationEvent
{
    Task HandleAsync(TEvent @event, CancellationToken ct = default);
}
```

Toàn bộ 5 service **chỉ code chống lại 2 interface này** — không service nào import trực tiếp
namespace `RabbitMQ.Client`. Nếu sau này đổi sang Kafka/Azure Service Bus, chỉ cần viết class
mới implement `IEventBus`, không phải sửa code ở 5 service.

Mọi event đều kế thừa 1 base record chung:
```csharp
// be/src/BuildingBlocks/AutoGrading.Contracts/Events/IntegrationEvent.cs
public abstract record IntegrationEvent
{
    public Guid EventId { get; init; } = Guid.NewGuid();       // để check trùng lặp (idempotency)
    public DateTimeOffset OccurredAt { get; init; } = DateTimeOffset.UtcNow;
}
```

---

## 5. Luồng PUBLISH — step by step

**Nơi gọi** (ví dụ thật, `be/src/Services/Identity/AutoGrading.Identity.Api/Service/AuthService.cs:53`):
```csharp
await repository.CreateUserAsync(user, ct);
await eventBus.PublishAsync(new UserRegistered(user.Id, user.Email, user.FullName, user.Role), ct);
```

**Bên trong `PublishAsync`** (`RabbitMqEventBus.cs:59-72`):
```csharp
public Task PublishAsync<TEvent>(TEvent @event, CancellationToken ct = default) where TEvent : IntegrationEvent
{
    var routingKey = typeof(TEvent).Name;                          // "UserRegistered"
    var body = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(@event, @event.GetType()));

    var properties = _channel.CreateBasicProperties();
    properties.Persistent = true;
    properties.ContentType = "application/json";

    _channel.BasicPublish(_options.Exchange, routingKey, properties, body);
    return Task.CompletedTask;
}
```

1. Lấy routing key = tên class (`"UserRegistered"`) — **tự động, không hardcode chuỗi**.
2. Serialize object thành JSON, encode UTF8.
3. Đánh dấu message `Persistent` (broker ghi xuống đĩa, không mất nếu broker restart).
4. `BasicPublish` gửi vào exchange `autograding.events` kèm routing key — exchange sẽ tự
   route tới đúng queue nào đã bind với routing key này.

---

## 6. Luồng SUBSCRIBE / CONSUME — step by step

**Đăng ký lúc service khởi động** (`be/src/Services/Notification/AutoGrading.Notification.Api/Program.cs:101`):
```csharp
var eventBus = app.Services.GetRequiredService<IEventBus>();
eventBus.Subscribe<UserRegistered, UserRegisteredConsumer>();
```

**Bên trong `Subscribe`** (`RabbitMqEventBus.cs:74-124`):
```csharp
public void Subscribe<TEvent, THandler>() where TEvent : IntegrationEvent where THandler : IIntegrationEventHandler<TEvent>
{
    var eventName = typeof(TEvent).Name;                     // "UserRegistered"
    var queueName = $"{_options.ServiceName}.{eventName}";   // "notification.UserRegistered"

    _channel.QueueDeclare(queueName, durable: true, exclusive: false, autoDelete: false);
    _channel.QueueBind(queueName, _options.Exchange, eventName);

    _eventTypesByName[eventName] = typeof(TEvent);
    _handlersByEventName.GetOrAdd(eventName, _ => new List<Type>()).Add(typeof(THandler));

    var consumer = new AsyncEventingBasicConsumer(_channel);
    consumer.Received += async (_, ea) =>
    {
        var json = Encoding.UTF8.GetString(ea.Body.ToArray());
        var eventType = _eventTypesByName[ea.RoutingKey];
        var @event = JsonSerializer.Deserialize(json, eventType);

        using var scope = _scopeFactory.CreateScope();          // tạo scope DI mới cho mỗi message
        foreach (var handlerType in _handlersByEventName[ea.RoutingKey])
        {
            var handler = scope.ServiceProvider.GetService(handlerType);
            await (Task)handlerType.GetMethod("HandleAsync")!.Invoke(handler, new[] { @event, CancellationToken.None })!;
        }
        _channel.BasicAck(ea.DeliveryTag, multiple: false);      // ack THỦ CÔNG, sau khi handler chạy xong
    };
    _channel.BasicConsume(queueName, autoAck: false, consumer);
}
```

1. Tạo queue riêng cho service này (`notification.UserRegistered`).
2. Bind queue vào exchange theo routing key = tên event.
3. Lưu lại "event nào → type gì, handler nào" vào 2 dictionary nội bộ.
4. Đăng ký consumer: khi có message tới, đọc `RoutingKey` để biết deserialize thành type gì
   và gọi handler nào (qua reflection, vì `IEventBus` là generic nhưng lúc runtime không biết
   trước type cụ thể).
5. `scope = _scopeFactory.CreateScope()` — **quan trọng**: `RabbitMqEventBus` là Singleton,
   nhưng handler thường cần DbContext (Scoped), nên phải tạo 1 scope DI mới **cho mỗi message**
   để resolve handler đúng cách.
6. `BasicAck` chỉ gọi **sau khi** `HandleAsync` chạy xong không lỗi → nếu handler throw
   exception, message **không được ack**, RabbitMQ sẽ giữ lại và gửi lại (redeliver) → đây là
   lý do handler bắt buộc phải viết **idempotent** (xử lý lại nhiều lần không sinh lỗi/trùng dữ liệu).

---

## 7. Bảng đầy đủ: Event → Publisher → Consumer → Handler

| # | Event | Phát bởi (service) | Vị trí publish | Nhận bởi (service) | Handler | Handler làm gì |
|---|---|---|---|---|---|---|
| 1 | `UserRegistered` | Identity | `AuthService.cs:53,112` | Notification | `UserRegisteredConsumer` | Ghi audit log + tạo notification chào mừng |
| 2 | `ClassLecturerAssigned` | Catalog | `ClassRepository.cs:77` | Identity | `ClassLecturerAssignedHandler` | Cache tên lớp + GV phụ trách |
| 3 | `RubricParsed` | Catalog | `RubricParsingJob.cs:70` | Notification | `RubricParsedConsumer` | Chỉ ghi audit log (event không có UserId nhận) |
| 4 | `RubricConfirmed` | Catalog | `RubricsEndpoints.cs:200` | Grading | `RubricConfirmedHandler` | Cache tiêu chí chấm điểm đã confirm |
| 5 | `SubmissionUploaded` | Submission | `SubmissionService.cs:75` | Identity | `SubmissionUploadedHandler` | Ghi map submission ↔ student |
| 5b | `SubmissionUploaded` | (như trên) | (như trên) | **Submission (tự nó)** | `SubmissionUploadedHandler` | Enqueue `ExtractionJob` (Hangfire) — tự subscribe lại event của chính mình |
| 6 | `SubmissionStatusChanged` | Submission, Grading | `SubmissionService.cs:79`, `ExtractionJob.cs:31,71,77`, `AiGradingJob.cs:39,84,104` | Notification | `SubmissionStatusChangedConsumer` | Push real-time qua **SignalR** cho student (duy nhất trong hệ thống làm việc này) |
| 7 | `ArtifactsExtracted` | Submission | `ExtractionJob.cs:72` | Grading | `ArtifactsExtractedHandler` | Enqueue `AiGradingJob` (Hangfire) |
| 8 | `AiGradingCompleted` | Grading | `AiGradingJob.cs:88` | Notification | `AiGradingCompletedConsumer` | Chỉ ghi audit log |
| 9 | `GradePublished` | Grading (qua **Outbox pattern**, xem mục 8) | `GradePublishedOutboxDispatcher.cs:21` | Identity | `GradePublishedHandler` | Ghi map submission ↔ người chấm |
| 9b | `GradePublished` | (như trên) | (như trên) | Notification | `GradePublishedConsumer` | Ghi audit log + tạo notification cho lecturer |

**Cặp service KHÔNG giao tiếp qua RabbitMQ:** Catalog ↔ Submission — hai service này liên lạc
qua **gRPC trực tiếp** (Submission gọi Catalog để lấy assignment info), không qua event.

### Vai trò từng service

| Service | Publish? | Subscribe? | Ghi chú |
|---|---|---|---|
| Identity | ✅ (1 event) | ✅ (3 event) | Vừa phát vừa nhận |
| Catalog | ✅ (3 event) | ❌ | **Thuần publisher**, không bao giờ nhận event |
| Submission | ✅ (3 event) | ✅ (chỉ tự nhận lại event của mình) | Vừa phát vừa nhận |
| Grading | ✅ (3 event) | ✅ (2 event) | Vừa phát vừa nhận |
| Notification | ❌ | ✅ (5 event) | **Thuần consumer**, không bao giờ phát event |

---

## 8. Outbox Pattern — riêng cho `GradePublished`

Đây là điểm kỹ thuật đáng nói nhất khi GV hỏi sâu, vì nó khác cách publish thông thường (publish
ngay sau khi save DB) ở 8 event còn lại.

**Vấn đề nó giải quyết:** nếu code publish event **ngay sau** khi `SaveChangesAsync`, có 1 khe hở
race condition: nếu process crash **giữa lúc** DB đã commit xong nhưng **trước khi** publish
kịp gửi đi, thì event bị mất vĩnh viễn — DB đã có dữ liệu nhưng không ai khác biết.

**Cách outbox pattern giải quyết:** ghi cả dữ liệu nghiệp vụ **và** "ý định publish" vào **cùng
1 transaction DB** — nếu transaction rollback thì cả hai đều rollback, nếu commit thì cả hai
đều chắc chắn tồn tại.

```csharp
// GradingRepository.cs:50-72 — ghi trong CÙNG 1 transaction
await using var transaction = await db.Database.BeginTransactionAsync(ct);

db.FinalGrades.Add(grade);
db.GradePublications.Add(new GradePublication { ... });
db.GradePublishedOutbox.Add(new GradePublishedOutbox      // <-- "ý định publish", ghi vào bảng outbox
{
    SubmissionId = submissionId, FinalGradeId = grade.Id,
    FinalScore = grade.FinalScore, PublishedByUserId = userId
});
await db.SaveChangesAsync(ct);
await transaction.CommitAsync(ct);
```

Sau đó, 1 `BackgroundService` chạy **độc lập, liên tục** (không phải Hangfire job, mà là
.NET `BackgroundService` thuần):

```csharp
// GradePublishedOutboxDispatcher.cs:9-31
protected override async Task ExecuteAsync(CancellationToken stoppingToken)
{
    while (!stoppingToken.IsCancellationRequested)
    {
        var messages = await repository.GetPendingOutboxMessagesAsync(100, stoppingToken);
        foreach (var message in messages)
        {
            await bus.PublishAsync(new GradePublished(...) { EventId = message.Id }, stoppingToken);
            await repository.MarkOutboxDispatchedAsync(message.Id, stoppingToken);
        }
        await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);   // poll mỗi 2 giây
    }
}
```

Nó liên tục **poll bảng outbox mỗi 2 giây**, lấy các message chưa dispatch, publish thật ra
RabbitMQ, rồi đánh dấu đã dispatch. Nếu process crash giữa chừng, message vẫn còn nằm trong
bảng outbox (chưa mark dispatched) → lần sau service khởi động lại, dispatcher sẽ publish lại
— **không thể mất event**, đánh đổi lấy độ trễ tối đa ~2 giây so với publish trực tiếp.

**Câu hỏi GV có thể hỏi**: "Vậy 8 event còn lại có bị mất khi crash không?" → Có thể, vì chúng
publish trực tiếp ngay trong request/job, không qua outbox — đây là điểm có thể cải thiện
nhưng chấp nhận được vì các event đó ít quan trọng bằng việc công bố điểm final.

---

## 9. Nguyên lý quan trọng — chuẩn bị trả lời "why"

| Nguyên lý | Giải thích ngắn | Câu trả lời khi bị hỏi "tại sao" |
|---|---|---|
| **Decoupling (tách rời)** | Producer không biết ai đang lắng nghe, consumer không biết ai đã gửi | Submission publish `SubmissionUploaded` mà không cần biết Identity có tồn tại/đang chạy hay không — nếu Identity down, message vẫn nằm chờ trong queue, không làm Submission bị lỗi |
| **Fan-out qua queue riêng** | 1 event có thể có N consumer, mỗi consumer có 1 queue riêng | Nếu Grading và Notification cùng subscribe `SubmissionStatusChanged`, mỗi bên có 1 queue riêng (`grading.SubmissionStatusChanged`, `notification.SubmissionStatusChanged`) — cả hai đều nhận đủ, không tranh nhau |
| **Idempotency** | Handler phải xử lý đúng dù bị gọi lại nhiều lần với cùng 1 message | Vì ack thủ công + redeliver khi lỗi → bắt buộc. Ví dụ: `GradePublishedConsumer.cs:16` check `AuditEvents.Any(x => x.IntegrationEventId == @event.EventId)` trước khi ghi |
| **Manual ack (không autoAck)** | Chỉ xoá message khỏi queue sau khi xử lý xong, không phải sau khi nhận | Đảm bảo "at-least-once delivery" — thà xử lý lại 1 message còn hơn làm mất nó |
| **Retry connection lúc khởi động** | `RabbitMqEventBus.cs:40-53` retry 5 lần, sleep 3s mỗi lần | Trong Docker Compose, các service có thể khởi động trước khi RabbitMQ sẵn sàng — cần chờ thay vì crash ngay |
| **Routing key tự sinh từ type name** | Không hardcode chuỗi ở bất kỳ đâu | Publisher và Subscriber luôn khớp nhau tự động miễn dùng chung 1 class contract trong `AutoGrading.Contracts` — không thể gõ sai chuỗi |
| **1 exchange dùng chung, không phải mỗi service 1 exchange** | Đơn giản hoá quản lý, mọi service đều "nhìn thấy" nhau qua cùng 1 điểm | Đây là kiến trúc pub/sub kinh điển — exchange là điểm trung tâm route, queue là nơi lưu trữ riêng |

---

## 10. Câu hỏi khó GV hay hỏi — chuẩn bị sẵn

**Q: Nếu Notification service chết, các service khác có bị ảnh hưởng không?**
A: Không. Publisher chỉ `BasicPublish` vào exchange rồi return ngay (fire-and-forget), không
chờ consumer xử lý. Message nằm chờ trong queue `notification.*` (đã declare `durable: true`)
cho tới khi Notification sống lại và consume tiếp — không bị mất, không làm nghẽn publisher.

**Q: Làm sao đảm bảo message không bị xử lý 2 lần gây sai dữ liệu?**
A: Không đảm bảo "chỉ 1 lần" ở tầng broker (đây là mô hình at-least-once) — mà đảm bảo ở tầng
handler bằng cách viết idempotent: check tồn tại trước khi insert (`SubmissionUploadedHandler`),
bắt riêng `DbUpdateException` do vi phạm khoá chính (`ex.IsPrimaryKeyViolation()`), hoặc check
theo `EventId` (`GradePublishedConsumer`).

**Q: Sao không gọi thẳng HTTP giữa các service cho đơn giản, cần gì RabbitMQ?**
A: Vì các quan hệ này là "thông báo thay đổi trạng thái", không cần phản hồi ngay (không có
response value nào cần trả lại nơi gọi) và không nên tạo phụ thuộc cứng thời gian thực — nếu
dùng HTTP, publisher phải chờ consumer trả lời, và nếu consumer đang down thì publisher cũng
lỗi theo (cascading failure). Ngược lại, những chỗ THẬT SỰ cần dữ liệu ngay để trả response
(Submission cần biết assignment có tồn tại không) thì dự án vẫn dùng gRPC/HTTP đồng bộ — đây
là lựa chọn có chủ đích tuỳ theo loại giao tiếp, không phải dùng RabbitMQ cho tất cả.

**Q: Exchange loại topic mà dự án có dùng wildcard routing không?**
A: Chưa — hiện routing key luôn khớp chính xác 1-1 với tên event. Chọn `topic` thay vì `direct`
để dễ mở rộng sau này (vd 1 service muốn nghe tất cả event bắt đầu bằng `Submission*`).

**Q: Cấu hình RabbitMQ ở đâu, muốn đổi thì sửa file nào?**
A: `RabbitMqOptions` (`RabbitMqOptions.cs`) đọc từ section `"RabbitMq"` trong
`appsettings.json` của từng service, bị override bằng biến môi trường `RabbitMq__*` trong
`docker-compose.yml`. Muốn đổi exchange/host/port ở môi trường Docker thì sửa
`docker-compose.yml`, không phải sửa code.

**Q: Điều gì xảy ra nếu 2 service lỡ dùng trùng `ServiceName`?**
A: Cả hai sẽ tạo/dùng chung 1 queue (vì tên queue = `{ServiceName}.{EventName}`) → trở thành
"competing consumers", mỗi message chỉ 1 trong 2 process nhận được (bị chia ngẫu nhiên) thay vì
cả hai đều nhận đủ — đây là lỗi cấu hình, code hiện tại không có gì assert `ServiceName` là duy
nhất.

**Q: SignalR có liên quan gì tới RabbitMQ không?**
A: Không phải cùng 1 công nghệ. RabbitMQ là kênh BE↔BE. `SubmissionStatusChangedConsumer` là
handler nhận event từ RabbitMQ **xong rồi mới** gọi tiếp sang SignalR (`IHubContext.Clients
.User(...).SendAsync(...)`) để đẩy ra trình duyệt — đây là bước **thứ 2, riêng biệt**, xảy ra
sau khi đã nhận xong qua RabbitMQ, không phải RabbitMQ tự đẩy ra được frontend.

---

## 11. Index — file nào ở đâu (tra cứu nhanh lúc demo)

```
be/src/BuildingBlocks/AutoGrading.Common/Messaging/
  IEventBus.cs                 → interface + IIntegrationEventHandler
  RabbitMqEventBus.cs           → implementation thật (connection, publish, subscribe, ack)
  RabbitMqOptions.cs            → config class

be/src/BuildingBlocks/AutoGrading.Contracts/Events/
  IntegrationEvent.cs            → base record (EventId, OccurredAt)
  UserRegistered.cs, ClassLecturerAssigned.cs, RubricParsed.cs, RubricConfirmed.cs,
  SubmissionUploaded.cs, SubmissionStatusChanged.cs, ArtifactsExtracted.cs,
  AiGradingCompleted.cs, GradePublished.cs    → 9 event record cụ thể

be/src/BuildingBlocks/AutoGrading.Common/Extensions/ServiceCollectionExtensions.cs
  → AddEventBus() extension method (đăng ký DI)

be/src/Services/{Identity,Catalog,Submission,Grading,Notification}/.../Program.cs
  → mỗi service gọi AddEventBus() + Subscribe<>() cho các event nó cần

be/src/Services/{Identity,Catalog,Submission,Grading,Notification}/.../Handlers|Consumers/
  → các class implement IIntegrationEventHandler<TEvent>

be/src/Services/Grading/AutoGrading.Grading.Api/Jobs/GradePublishedOutboxDispatcher.cs
  → BackgroundService cho Outbox pattern

docker-compose.yml
  → biến môi trường RabbitMq__* cho từng service (dòng ~66-70, 97-101, 135-139, 172-176, 208-212)
```
