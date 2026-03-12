import { jsx, jsxs } from "react/jsx-runtime";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import useLang from "../hooks/useLang.js";
import useCall from "../hooks/useCall.js";
import useReset from "../hooks/useReset.js";
import useStore from "../hooks/useStore.js";
import "./index.css";
const magnifierWidth = 100;
const magnifierHeight = 80;
const Screenshots_ScreenshotsMagnifier = /*#__PURE__*/ memo(function({ x, y }) {
    const { width, height, image } = useStore();
    const lang = useLang();
    const call = useCall();
    const reset = useReset();
    const [position, setPosition] = useState(null);
    const elRef = useRef(null);
    const canvasRef = useRef(null);
    const ctxRef = useRef(null);
    const [colorMode, setColorMode] = useState('HEX');
    const [hex, setHex] = useState('000000');
    const [rgbText, setRgbText] = useState('rgb(0, 0, 0)');
    useLayoutEffect(()=>{
        if (!elRef.current) return;
        const elRect = elRef.current.getBoundingClientRect();
        let tx = x + 20;
        let ty = y + 20;
        if (tx + elRect.width > width) tx = x - elRect.width - 20;
        if (ty + elRect.height > height) ty = y - elRect.height - 20;
        if (tx < 0) tx = 0;
        if (ty < 0) ty = 0;
        setPosition({
            x: tx,
            y: ty
        });
    }, [
        width,
        height,
        x,
        y
    ]);
    useEffect(()=>{
        if (!image || !canvasRef.current) {
            ctxRef.current = null;
            return;
        }
        if (!ctxRef.current) ctxRef.current = canvasRef.current.getContext('2d');
        if (!ctxRef.current) return;
        const ctx = ctxRef.current;
        ctx.clearRect(0, 0, magnifierWidth, magnifierHeight);
        const rx = image.naturalWidth / width;
        const ry = image.naturalHeight / height;
        ctx.drawImage(image, x * rx - magnifierWidth / 2, y * ry - magnifierHeight / 2, magnifierWidth, magnifierHeight, 0, 0, magnifierWidth, magnifierHeight);
        const { data } = ctx.getImageData(Math.floor(magnifierWidth / 2), Math.floor(magnifierHeight / 2), 1, 1);
        const [r, g, b] = data;
        const hex = Array.from(data.slice(0, 3)).map((val)=>val >= 16 ? val.toString(16) : `0${val.toString(16)}`).join('').toUpperCase();
        setHex(hex);
        setRgbText(`rgb(${r}, ${g}, ${b})`);
    }, [
        width,
        height,
        image,
        x,
        y
    ]);
    useEffect(()=>{
        const isEditableTarget = (target)=>{
            if (!target || !(target instanceof HTMLElement)) return false;
            if (target.isContentEditable) return true;
            const tagName = target.tagName.toLowerCase();
            return 'input' === tagName || 'textarea' === tagName || 'select' === tagName;
        };
        const copyText = async (text)=>{
            try {
                if (window.screenshots?.copyText) return void window.screenshots.copyText(text);
                if (navigator.clipboard?.writeText) return void await navigator.clipboard.writeText(text);
            } catch  {}
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                document.execCommand('copy');
            } finally{
                textarea.remove();
            }
        };
        const onKeyDown = (e)=>{
            if (isEditableTarget(e.target)) return;
            if ('Shift' === e.key && !e.repeat) {
                e.preventDefault();
                e.stopImmediatePropagation();
                setColorMode((prev)=>'HEX' === prev ? 'RGB' : 'HEX');
                return;
            }
            const isKeyC = 'KeyC' === e.code || 'c' === e.key || 'C' === e.key;
            if (isKeyC && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const text = 'HEX' === colorMode ? `#${hex}` : rgbText;
                copyText(text).finally(()=>{
                    call?.('onCancel');
                    reset();
                });
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return ()=>{
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, [
        colorMode,
        hex,
        rgbText,
        call,
        reset
    ]);
    return /*#__PURE__*/ jsxs("div", {
        ref: elRef,
        className: "screenshots-magnifier",
        style: {
            transform: `translate(${position?.x}px, ${position?.y}px)`
        },
        children: [
            /*#__PURE__*/ jsx("div", {
                className: "screenshots-magnifier-body",
                children: /*#__PURE__*/ jsx("canvas", {
                    ref: canvasRef,
                    className: "screenshots-magnifier-body-canvas",
                    width: magnifierWidth,
                    height: magnifierHeight
                })
            }),
            /*#__PURE__*/ jsxs("div", {
                className: "screenshots-magnifier-footer",
                children: [
                    /*#__PURE__*/ jsxs("div", {
                        className: "screenshots-magnifier-footer-item",
                        children: [
                            lang.magnifier_position_label,
                            ": (",
                            x,
                            ",",
                            y,
                            ")"
                        ]
                    }),
                    /*#__PURE__*/ jsxs("div", {
                        className: "screenshots-magnifier-footer-item",
                        style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6
                        },
                        children: [
                            /*#__PURE__*/ jsx("span", {
                                children: 'HEX' === colorMode ? 'HEX:' : 'RGB:'
                            }),
                            /*#__PURE__*/ jsx("span", {
                                style: {
                                    width: 10,
                                    height: 10,
                                    backgroundColor: 'HEX' === colorMode ? `#${hex}` : rgbText,
                                    display: 'inline-block',
                                    border: '1px solid rgba(255, 255, 255, 0.6)'
                                }
                            }),
                            /*#__PURE__*/ jsx("span", {
                                children: 'HEX' === colorMode ? `#${hex}` : rgbText
                            })
                        ]
                    }),
                    /*#__PURE__*/ jsx("div", {
                        className: "screenshots-magnifier-footer-tips",
                        children: /*#__PURE__*/ jsxs("span", {
                            children: [
                                "按 ",
                                /*#__PURE__*/ jsx("span", {
                                    className: "tips-key",
                                    children: "C"
                                }),
                                " 复制 / 按 ",
                                /*#__PURE__*/ jsx("span", {
                                    className: "tips-key",
                                    children: "Shift"
                                }),
                                " 切换"
                            ]
                        })
                    })
                ]
            })
        ]
    });
});
export { Screenshots_ScreenshotsMagnifier as default };
