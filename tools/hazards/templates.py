"""Create submission workbooks in the existing Data / Field guide convention."""
import csv
import sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from collection import REPO

guide={
 'name':'Recorded locality or event name.', 'country':'Country as documented by the source.',
 'latitude':'WGS84 decimal latitude (-90 to 90). Explain approximate coordinates in notes.',
 'longitude':'WGS84 decimal longitude (-180 to 180). Explain approximate coordinates in notes.',
 'source':'Traceable publication, DOI, agency report or dataset URL.', 'licence':'Source reuse terms, including any restrictions.',
 'date':'Reported date. Preserve partial dates and explain uncertainty in notes.',
 'original_id':'Identifier in the original source.', 'event_id':'Documented related event identifier, if available.',
 'measurements':'Reported measurements; state methods and uncertainty in notes.',
 'units':'Units for every measurement. Do not infer missing quantities.',
 'geometry_file':'Filename of any attached geometry. Include its coordinate reference system.',
 'notes':'Interpretation, references and uncertainty. For corrections, give the existing catalogue ID.'}
for slug in sys.argv[1:]:
    site=REPO/'sites'/slug
    with (site/'templates/data-template.csv').open(encoding='utf-8-sig',newline='') as f:
        columns=next(csv.reader(f))
    book=Workbook();data=book.active;data.title='Data';data.append(columns);data.freeze_panes='A2';data.auto_filter.ref=f'A1:M101'
    field_guide=book.create_sheet('Field guide');field_guide.append(['Field','Required','Description'])
    for key in columns:field_guide.append([key,'Yes' if key in ['name','country','latitude','longitude','source','licence'] else 'Optional',guide[key]])
    for sheet in [data,field_guide]:
        sheet.freeze_panes='A2';sheet.row_dimensions[1].height=30
        for cell in sheet[1]:cell.font=Font(name='Calibri',size=11,bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='1E3A5F');cell.alignment=Alignment(vertical='center',wrap_text=True)
        for row in sheet.iter_rows(min_row=2):
            for cell in row:cell.font=Font(name='Calibri',size=11);cell.alignment=Alignment(vertical='top',wrap_text=True)
    for col in 'ABCDEFGHIJKLM':data.column_dimensions[col].width=24
    data.column_dimensions['E'].width=48;data.column_dimensions['M'].width=60
    field_guide.column_dimensions['A'].width=24;field_guide.column_dimensions['B'].width=15;field_guide.column_dimensions['C'].width=95
    for row in range(2,len(columns)+2):field_guide.row_dimensions[row].height=34
    for col,bound in [('C',90),('D',180)]:
        validation=DataValidation(type='decimal',operator='between',formula1=-bound,formula2=bound,allow_blank=True);validation.error='Enter WGS84 coordinates within the stated range.';validation.showErrorMessage=True;data.add_data_validation(validation);validation.add(f'{col}2:{col}10001')
    book.save(site/'templates/data-template.xlsx')
    path=site/'index.html';markup=path.read_text(encoding='utf-8')
    if './templates/data-template.xlsx' not in markup:
        markup=markup.replace('<a class="btn-primary" href="./templates/data-template.csv" download>','<a class="btn-primary" href="./templates/data-template.xlsx" download>Download XLSX</a><a class="btn-primary" href="./templates/data-template.csv" download>',1)
        path.write_text(markup,encoding='utf-8')
    print(slug,'submission workbook prepared',flush=True)
