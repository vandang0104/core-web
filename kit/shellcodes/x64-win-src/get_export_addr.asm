BITS 64

; wasm arg1 = module_base_addr -> rax
; wasm arg2 = function_name -> rdx
; wasm arg3 = function_name_length -> rcx

mov r9, rcx
mov r8, rdx
mov rdx, rax

push rsi
push rdi

xor rax,rax
xor rbx, rbx
xor rcx, rcx
xor r10, r10
xor r11, r11
xor rdi, rdi

mov dword eax, [rdx+3Ch]                     ; *PE header
mov dword eax, [rdx+rax+88h]                 ; *Export table
mov dword r10d, [rdx+rax+18h]                ; NumberOfNames
mov dword ecx, [rdx+rax+1Ch]                 ; AddressOfFunctions
mov dword ebx, [rdx+rax+20h]                 ; AddressOfNames
mov dword eax, [rdx+rax+24h]                 ; AddressOfNameOrdinals

push rcx
find_export:
    mov rcx, r9                              ; function_name_length
    mov rsi, r8                              ; function_name
    mov dword edi, [rdx+rbx]                 ; Name
    lea rdi, [rdx+rdi]
    repe cmpsb
    je found
    add ebx, 4h                              ; *Name++
    add eax, 2h                              ; *Ordinal++
    dec r10
    jz not_found
    jmp find_export

found:
    pop rcx                                  ; AddressOfFunctions
    add rcx, rdx
    mov word r11w, [rdx+rax]                 ; Ordinal
    mov dword eax, [rcx+4*r11]               ; RVA
    jmp end

not_found:
    pop rcx
    mov rax, 0h

end:
    pop rdi
    pop rsi
    ret
