BITS 64

; wasm arg1 = module_name -> rax
; wasm arg2 = module_name_length -> rdx

mov r8, rax

push rsi
push rdi

xor rax, rax;
mov rax, gs:[rax+0x60];                      ; PEB
mov rax, [rax+18h]                           ; Ldr
mov r9, [rax+28h]                            ; *InMemoryOrderModuleList (end)
lea rax, [rax+20h]                           ; *InMemoryOrderModuleList (start)

next_module:
    cmp rax, r9
    je not_found
    mov rax, [rax]                           ; next module
    mov rcx, rdx                             ; module_name_length
    mov rsi, r8                              ; module_name
    mov rdi, [rax-10h+60h]                   ; BaseDllName
    repe cmpsb
    jne next_module
    mov rax, [rax-10h+30h]                   ; DllBase
    jmp end

not_found:
    mov rax, 0h

end:
    pop rdi
    pop rsi
    ret
