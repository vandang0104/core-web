BITS 64

; wasm arg1 = function_addr -> rax
; wasm arg2 = function arg1 -> rdx
; wasm arg3 = function arg2 -> rcx
; wasm arg4 = function arg3 -> rbx
; wasm arg5 = function arg4 -> r9
; wasm args = function args >=5 -> stack


; move arguments to conventional registers
xchg rdx, rcx
mov r8, rbx


; retrieve the return address from the stack
pop rbx


; check stack alignment
mov r10, rsp
and rsp, -16
cmp r10, rsp
je no_align


; align the whole stack
align_stack:
    mov r11, [r10]
    mov [r10-0x8], r11
    add r10, 0x8
    cmp r10, rbp
    jne align_stack


; create shadow space and jump to target function
sub rsp, 0x20
call rax


; restore the stack
lea r10, [rbp-0x10]
restore_stack:
    mov r11, [r10]
    mov [r10+0x8], r11
    sub r10, 0x8
    cmp r10, rsp
    jne restore_stack
    add rsp, 0x28
    jmp ret_addr


; no need to align the stack
; create shadow space and jump to target function
no_align:
    sub rsp, 0x20
    call rax
    add rsp, 0x20


; jump to original return address
ret_addr:
    push rbx
    ret
