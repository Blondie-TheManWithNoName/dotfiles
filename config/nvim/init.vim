" --- Initialize vim-plug ---
call plug#begin('~/.vim/plugged')

" Plugin: vimBeGood game
Plug 'ThePrimeagen/vim-be-good'

call plug#end()

" --- Basic Settings ---
set number              " Show line numbers
set relativenumber      " Show relative numbers
set tabstop=4           " 1 tab = 4 spaces
set shiftwidth=4        " Indentation = 4 spaces
set expandtab           " Use spaces instead of tabs
set mouse=a             " Enable mouse support
syntax on               " Enable syntax highlighting
filetype plugin indent on " Enable filetype-based plugins

