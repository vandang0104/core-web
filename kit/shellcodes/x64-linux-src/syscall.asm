BITS 64

; wasm arg1 = syscall number -> rax
; wasm arg2 = arg1 -> rdx
; wasm arg3 = arg2 -> rcx
; wasm arg4 = arg3 -> rbx
; wasm arg5 = arg4 -> r9
; wasm arg6/7 = arg5/6 -> stack

mov rdi, rdx
mov rsi, rcx
mov rdx, rbx
mov r10, r9
mov r8, [rsp+0x8]
mov r9, [rsp+0x10]

syscall
ret
