"""glm_flashes.py: reading GLM file names and keeping only good flashes inside a night's box and window.

The GLM file here is built in memory with the real file's variable names, types and scaling, so nothing touches the network.
"""

from datetime import UTC, datetime

import netCDF4
import numpy as np
import pytest

from glm_flashes import Night, file_start, flashes_in, parse_time

NIGHT = Night(
    slug="nashville",
    night_id="2021-03-28T03:55",
    start=datetime(2021, 3, 28, 3, 5, tzinfo=UTC),
    end=datetime(2021, 3, 28, 10, 10, tzinfo=UTC),
    bounds=(-88.11, 35.08, -85.44, 37.25),
    lat=36.168175,
    lon=-86.777516,
    satellite=16,
)


def glm_file(rows: list[tuple[float, float, float, float, float, int]], base: str = "2021-03-28 03:05:00.000") -> bytes:
    """A GLM-shaped NetCDF4 file in memory.

    Args:
        rows: (seconds after base, lat, lon, energy in J, area in m2, quality flag) per flash.
        base: The file's time base, as in its "seconds since" units.

    Returns:
        The file's bytes.
    """
    dataset = netCDF4.Dataset("test", mode="w", memory=1024, format="NETCDF4")
    dataset.createDimension("number_of_flashes", len(rows))
    columns = list(zip(*rows, strict=True)) if rows else [[]] * 6
    lat = dataset.createVariable("flash_lat", "f4", ("number_of_flashes",))
    lon = dataset.createVariable("flash_lon", "f4", ("number_of_flashes",))
    lat[:], lon[:] = np.array(columns[1]), np.array(columns[2])
    for name, values, scale, offset, units in [
        ("flash_time_offset_of_first_event", columns[0], 0.0003814756, -5.0, f"seconds since {base}"),
        ("flash_energy", columns[3], 9.99996e-16, 2.8515e-16, "J"),
        ("flash_area", columns[4], 152601.86, 0.0, "m2"),
    ]:
        variable = dataset.createVariable(name, "i2", ("number_of_flashes",))
        variable.setncatts({"_Unsigned": "true", "scale_factor": np.float32(scale), "add_offset": np.float32(offset), "units": units})
        variable[:] = np.array(values, dtype=float)
    quality = dataset.createVariable("flash_quality_flag", "i2", ("number_of_flashes",))
    quality[:] = np.array(columns[5], dtype=np.int16)
    return bytes(dataset.close())


class TestFileStart:
    def test_reads_the_day_of_year_and_tenth_of_a_second(self) -> None:
        key = "GLM-L2-LCFA/2021/087/03/OR_GLM-L2-LCFA_G16_s20210870300200_e20210870300405_c20210870300423.nc"
        assert file_start(key) == datetime(2021, 3, 28, 3, 0, 20, tzinfo=UTC)

    def test_a_name_without_a_start_is_none(self) -> None:
        assert file_start("GLM-L2-LCFA/2021/087/03/readme.txt") is None


class TestFlashesIn:
    def test_keeps_good_flashes_inside_the_box_with_time_energy_and_area(self) -> None:
        data = glm_file([(1.5, 36.2, -86.8, 1.29e-13, 305203.7, 0)])
        [[seconds, lat, lon, energy_fj, area_km2]] = flashes_in(data, NIGHT)
        assert seconds == pytest.approx(1.5, abs=0.1)
        assert (lat, lon) == (pytest.approx(36.2, abs=1e-4), pytest.approx(-86.8, abs=1e-4))
        assert energy_fj == pytest.approx(129.3, abs=1.1)
        assert area_km2 == pytest.approx(0.3, abs=0.05)

    def test_drops_flagged_flashes_and_flashes_outside_the_box(self) -> None:
        data = glm_file([
            (1.0, 36.2, -86.8, 1e-13, 3e5, 1),
            (1.0, 40.0, -86.8, 1e-13, 3e5, 0),
            (1.0, 36.2, -90.0, 1e-13, 3e5, 0),
        ])
        assert flashes_in(data, NIGHT) == []

    def test_drops_flashes_before_the_night_starts(self) -> None:
        data = glm_file([(-4.0, 36.2, -86.8, 1e-13, 3e5, 0), (2.0, 36.2, -86.8, 1e-13, 3e5, 0)], base="2021-03-28 03:05:00.000")
        assert [row[0] for row in flashes_in(data, NIGHT)] == [pytest.approx(2.0, abs=0.1)]

    def test_a_file_with_no_flashes_gives_none(self) -> None:
        assert flashes_in(glm_file([]), NIGHT) == []


def test_parse_time_reads_z_as_utc() -> None:
    assert parse_time("2021-03-28T03:05:00Z") == datetime(2021, 3, 28, 3, 5, tzinfo=UTC)
