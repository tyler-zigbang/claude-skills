# -*- coding: utf-8 -*-
# 2Q26 시트 XML만 교체하고 나머지 zip 엔트리는 그대로 복사 (이미지/메모 보존)
import re
import zipfile
import xml.etree.ElementTree as ET

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ET.register_namespace('', NS)
ET.register_namespace('r', RNS)

def q(tag):
    return f'{{{NS}}}{tag}'

zin = zipfile.ZipFile('quarterly.xlsx')

# sheet name -> xml path
wbroot = ET.fromstring(zin.read('xl/workbook.xml'))
rels = ET.fromstring(zin.read('xl/_rels/workbook.xml.rels'))
relmap = {}
for rel in rels:
    relmap[rel.get('Id')] = rel.get('Target')
sheetpath = {}
for sh in wbroot.find(q('sheets')):
    target = relmap[sh.get(f'{{{RNS}}}id')]
    if not target.startswith('xl/'):
        target = 'xl/' + target.lstrip('/')
    sheetpath[sh.get('name')] = target
src_path = sheetpath['1Q26']
dst_path = sheetpath['2Q26']
print('src:', src_path, '/ dst:', dst_path)

# shared strings
sst = []
if 'xl/sharedStrings.xml' in zin.namelist():
    sstroot = ET.fromstring(zin.read('xl/sharedStrings.xml'))
    for si in sstroot:
        sst.append(''.join(t.text or '' for t in si.iter(q('t'))))

with open('c5.txt', encoding='utf-8') as f:
    C5 = f.read()
with open('c8.txt', encoding='utf-8') as f:
    C8 = f.read()
NEW = {'B2': 'Smart Home 2Q26 분기 리뷰 및 계획', 'C5': C5, 'C8': C8, 'C14': ''}

root = ET.fromstring(zin.read(src_path))

def colnum(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n

sheet_data = root.find(q('sheetData'))
for row in list(sheet_data):
    if int(row.get('r')) > 20:
        sheet_data.remove(row)
        continue
    for c in list(row):
        ref = c.get('r')
        if ref in NEW or c.get('t') == 's':
            if ref in NEW:
                text = NEW[ref]
            else:
                v = c.find(q('v'))
                text = sst[int(v.text)] if v is not None else ''
            for child in list(c):
                c.remove(child)
            c.set('t', 'inlineStr')
            iselem = ET.SubElement(c, q('is'))
            t = ET.SubElement(iselem, q('t'))
            t.text = text
            t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')

# 관계(rels) 참조 요소 제거 (2Q26에는 rels 파일을 만들지 않음)
for tag in ('drawing', 'legacyDrawing', 'legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'tableParts', 'hyperlinks'):
    for el in root.findall(q(tag)):
        root.remove(el)
for el in root.findall(q('pageSetup')):
    if el.get(f'{{{RNS}}}id'):
        del el.attrib[f'{{{RNS}}}id']

dim = root.find(q('dimension'))
if dim is not None:
    dim.set('ref', 'A1:M20')

new_xml = b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + ET.tostring(root)

# 2Q26 시트에 자체 rels가 있으면 제거 대상 확인
dst_rels = dst_path.replace('worksheets/', 'worksheets/_rels/') + '.rels'
print('dst rels exists:', dst_rels in zin.namelist())

zout = zipfile.ZipFile('quarterly_surgical.xlsx', 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    if item.filename == dst_path:
        zout.writestr(item, new_xml)
    elif item.filename == dst_rels:
        continue
    else:
        zout.writestr(item, zin.read(item.filename))
zout.close()
zin.close()

# 검증
import openpyxl
wb = openpyxl.load_workbook('quarterly_surgical.xlsx')
ws = wb['2Q26']
print('B2:', ws['B2'].value[:40])
print('C5 starts:', (ws['C5'].value or '')[:50].replace('\n', ' / '))
print('C8 starts:', (ws['C8'].value or '')[:50].replace('\n', ' / '))
print('merged:', ws.merged_cells.ranges)
a = zipfile.ZipFile('quarterly.xlsx')
b = zipfile.ZipFile('quarterly_surgical.xlsx')
lost = set(a.namelist()) - set(b.namelist())
print('lost entries:', lost)
