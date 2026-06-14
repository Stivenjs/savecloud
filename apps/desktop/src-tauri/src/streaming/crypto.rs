//! FFI C bindings para abstraer la criptografía de moonlight-common-c.
//! En lugar de compilar OpenSSL o MbedTLS en C, implementamos las 5 funciones
//! requeridas por la plataforma C nativamente en Rust usando crates modernos.

use aes::cipher::{BlockDecryptMut, BlockEncryptMut, KeyInit, KeyIvInit};
use aes_gcm::{
    aead::{Aead, Payload},
    Aes128Gcm, Nonce,
};
use cbc::{Decryptor, Encryptor};
use rand::RngCore;
use std::ffi::c_void;
use std::slice;

// Constantes de moonlight-common-c
const ALGORITHM_AES_CBC: i32 = 1;
const ALGORITHM_AES_GCM: i32 = 2;

const CIPHER_FLAG_RESET_IV: i32 = 0x01;
#[allow(dead_code)]
const CIPHER_FLAG_FINISH: i32 = 0x02;
const CIPHER_FLAG_PAD_TO_BLOCK_SIZE: i32 = 0x04;

type Aes128CbcEnc = Encryptor<aes::Aes128>;
type Aes128CbcDec = Decryptor<aes::Aes128>;

pub struct RustCryptoContext {
    pub initialized: bool,
    pub is_encrypt: bool,
    pub algorithm: i32,
    pub key: Vec<u8>,
    pub iv: Vec<u8>,
}

#[no_mangle]
pub extern "C" fn PltCreateCryptoContext() -> *mut c_void {
    let ctx = Box::new(RustCryptoContext {
        initialized: false,
        is_encrypt: false,
        algorithm: 0,
        key: Vec::new(),
        iv: Vec::new(),
    });
    Box::into_raw(ctx) as *mut c_void
}

#[no_mangle]
pub extern "C" fn PltDestroyCryptoContext(ctx_ptr: *mut c_void) {
    if !ctx_ptr.is_null() {
        unsafe {
            let _ = Box::from_raw(ctx_ptr as *mut RustCryptoContext);
        }
    }
}

#[no_mangle]
pub extern "C" fn PltGenerateRandomData(data: *mut u8, length: i32) {
    if data.is_null() || length <= 0 {
        return;
    }
    let slice = unsafe { slice::from_raw_parts_mut(data, length as usize) };
    rand::thread_rng().fill_bytes(slice);
}

#[no_mangle]
pub extern "C" fn PltEncryptMessage(
    ctx_ptr: *mut c_void,
    algorithm: i32,
    flags: i32,
    key_ptr: *const u8,
    key_length: i32,
    iv_ptr: *const u8,
    iv_length: i32,
    tag_ptr: *mut u8,
    tag_length: i32,
    input_data_ptr: *const u8,
    input_data_length: i32,
    output_data_ptr: *mut u8,
    output_data_length_ptr: *mut i32,
) -> bool {
    if ctx_ptr.is_null() {
        return false;
    }

    let ctx = unsafe { &mut *(ctx_ptr as *mut RustCryptoContext) };

    let key = unsafe { slice::from_raw_parts(key_ptr, key_length as usize) };
    let iv = unsafe { slice::from_raw_parts(iv_ptr, iv_length as usize) };
    let input = if !input_data_ptr.is_null() && input_data_length > 0 {
        unsafe { slice::from_raw_parts(input_data_ptr, input_data_length as usize) }
    } else {
        &[]
    };

    let out_len_ptr = unsafe { &mut *output_data_length_ptr };
    let output = unsafe { slice::from_raw_parts_mut(output_data_ptr, *out_len_ptr as usize) };

    if !ctx.initialized {
        ctx.algorithm = algorithm;
        ctx.key = key.to_vec();
        ctx.iv = iv.to_vec();
        ctx.initialized = true;
        ctx.is_encrypt = true;
    } else if (flags & CIPHER_FLAG_RESET_IV) != 0 {
        ctx.iv = iv.to_vec();
    }

    if algorithm == ALGORITHM_AES_GCM {
        if key_length != 16 {
            return false;
        } // Sólo AES-128
        let cipher = match Aes128Gcm::new_from_slice(&ctx.key) {
            Ok(c) => c,
            Err(_) => return false,
        };
        let nonce = Nonce::from_slice(&ctx.iv);

        match cipher.encrypt(
            nonce,
            Payload {
                msg: input,
                aad: &[],
            },
        ) {
            Ok(ciphertext) => {
                // ciphertext = [datos encriptados] + [tag de 16 bytes]
                let tag_len = tag_length as usize;
                if ciphertext.len() < tag_len {
                    return false;
                }
                let enc_len = ciphertext.len() - tag_len;

                output[..enc_len].copy_from_slice(&ciphertext[..enc_len]);
                if !tag_ptr.is_null() {
                    let tag = unsafe { slice::from_raw_parts_mut(tag_ptr, tag_len) };
                    tag.copy_from_slice(&ciphertext[enc_len..]);
                }
                *out_len_ptr = enc_len as i32;
                return true;
            }
            Err(_) => return false,
        }
    } else if algorithm == ALGORITHM_AES_CBC {
        // En AES-CBC moonlight provee el buffer input modificado o requiere PKCS7
        let mut data = input.to_vec();

        if (flags & CIPHER_FLAG_PAD_TO_BLOCK_SIZE) != 0 {
            let block_size = 16;
            let pad_len = block_size - (data.len() % block_size);
            data.extend(std::iter::repeat_n(pad_len as u8, pad_len));
        }

        let cipher = match Aes128CbcEnc::new_from_slices(&ctx.key, &ctx.iv) {
            Ok(c) => c,
            Err(_) => return false,
        };

        let mut out_blocks = data.clone();
        if cipher.encrypt_padded_mut::<aes::cipher::block_padding::NoPadding>(
            &mut out_blocks,
            data.len(),
        ).is_err() {
            return false;
        }

        output[..out_blocks.len()].copy_from_slice(&out_blocks);
        *out_len_ptr = out_blocks.len() as i32;
        return true;
    }

    false
}

#[no_mangle]
pub extern "C" fn PltDecryptMessage(
    ctx_ptr: *mut c_void,
    algorithm: i32,
    flags: i32,
    key_ptr: *const u8,
    key_length: i32,
    iv_ptr: *const u8,
    iv_length: i32,
    tag_ptr: *mut u8,
    tag_length: i32,
    input_data_ptr: *const u8,
    input_data_length: i32,
    output_data_ptr: *mut u8,
    output_data_length_ptr: *mut i32,
) -> bool {
    if ctx_ptr.is_null() {
        return false;
    }

    let ctx = unsafe { &mut *(ctx_ptr as *mut RustCryptoContext) };

    let key = unsafe { slice::from_raw_parts(key_ptr, key_length as usize) };
    let iv = unsafe { slice::from_raw_parts(iv_ptr, iv_length as usize) };
    let input = if !input_data_ptr.is_null() && input_data_length > 0 {
        unsafe { slice::from_raw_parts(input_data_ptr, input_data_length as usize) }
    } else {
        &[]
    };

    let out_len_ptr = unsafe { &mut *output_data_length_ptr };
    let output = unsafe { slice::from_raw_parts_mut(output_data_ptr, *out_len_ptr as usize) };

    if !ctx.initialized {
        ctx.algorithm = algorithm;
        ctx.key = key.to_vec();
        ctx.iv = iv.to_vec();
        ctx.initialized = true;
        ctx.is_encrypt = false;
    } else if (flags & CIPHER_FLAG_RESET_IV) != 0 {
        ctx.iv = iv.to_vec();
    }

    if algorithm == ALGORITHM_AES_GCM {
        let cipher = match Aes128Gcm::new_from_slice(&ctx.key) {
            Ok(c) => c,
            Err(_) => return false,
        };
        let nonce = Nonce::from_slice(&ctx.iv);
        let tag = if !tag_ptr.is_null() && tag_length > 0 {
            unsafe { slice::from_raw_parts(tag_ptr, tag_length as usize) }
        } else {
            &[]
        };

        let mut payload_data = input.to_vec();
        payload_data.extend_from_slice(tag);

        match cipher.decrypt(
            nonce,
            Payload {
                msg: &payload_data,
                aad: &[],
            },
        ) {
            Ok(plaintext) => {
                output[..plaintext.len()].copy_from_slice(&plaintext);
                *out_len_ptr = plaintext.len() as i32;
                return true;
            }
            Err(_) => return false,
        }
    } else if algorithm == ALGORITHM_AES_CBC {
        let cipher = match Aes128CbcDec::new_from_slices(&ctx.key, &ctx.iv) {
            Ok(c) => c,
            Err(_) => return false,
        };

        let mut out_blocks = input.to_vec();
        if cipher.decrypt_padded_mut::<aes::cipher::block_padding::NoPadding>(&mut out_blocks).is_err()
        {
            return false;
        }

        output[..out_blocks.len()].copy_from_slice(&out_blocks);
        *out_len_ptr = out_blocks.len() as i32;
        return true;
    }

    false
}
