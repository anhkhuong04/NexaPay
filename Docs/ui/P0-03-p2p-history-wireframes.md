# P0-03 — Send và lịch sử (implementation wireframe)

Nguồn: [UI Spec UI-05–07](../NexaPay_UIUX_DESIGN_SPEC_v0.1.md).
Dùng Fluent UI React v9/Fluent 2 và tokens đã có; không thêm UI kit.

```text
Desktop                                  Mobile (390 / 320 px)
Sidebar | Chuyển tiền                    Nav → Chuyển tiền
        | Form             | Ví gửi      Ví gửi / số dư hiện tại
        | Wallet ID [Tra]  | Số dư       Wallet ID [Tra cứu]
        | Tên + ID         | Mô phỏng    Tên người nhận + ID
        | Số tiền VND      |             Số tiền VND
        | Lời nhắn         |             Lời nhắn
        | [Tiếp tục]                     [Tiếp tục]
        | Review recipient/source/amount/fee 0/total/note
        | [Quay lại] [Xác nhận chuyển]
        | Processing → Receipt / từ chối / UNKNOWN
```

- Lookup chỉ bấm explicit, exact UUID. Sửa ID xóa selection; review dùng selection
  đã xác nhận, không nhận tên tự nhập. Amount nhận digits hoặc grouping dấu chấm
  vi-VN chính xác (`10.000`); không dấu phẩy, dấu thập phân, exponent hay làm tròn.
- Form/draft chỉ memory, confirm tạo key/lưu reference trước POST. Processing
  khóa confirm; UNKNOWN giữ key/draft, lookup backoff tổng tối đa 60s rồi manual.
- Reload/re-auth lookup theo reference. Reference operation khác dẫn về màn tương
  ứng, không overwrite; terminal mới cho phép bắt đầu intent mới.
- Receipt có amount, recipient/ID, source, fee=0, note, thời gian local rõ timezone,
  status/transaction ID, link detail và về ví. Không suy success từ số dư.

```text
Lịch sử giao dịch             [Tải lại]
[Từ ngày UTC] [Đến ngày UTC] [Loại] [Trạng thái] [Lọc]
Nhận tiền / Chuyển tiền / Tiền demo | amount | status
Tên + wallet ID | timestamp (local) | [Xem chi tiết]
[Xem thêm]  (cursor stable, newest first)
```

- Date picker inclusive days UTC → API from inclusive / to exclusive UTC. UI ghi
  rõ bộ lọc theo UTC, timestamp render local có timezone. Empty/error/retry states.
- Mobile stacked rows, UUID wrap; labels visible, focus rõ, CTA ≥44px, không sticky
  che input/keyboard. Inline review focus Back; receipt live outcome announcement.
- Detail không lộ email/command key; recipient chỉ SUCCEEDED incoming. History và
  cache actor-scoped; invalidation sau terminal result gồm wallet/history/commands.
